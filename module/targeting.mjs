/**
 * Attack targeting mode: pressing Attack without a target enters a
 * crosshair mode — the next enemy clicked is targeted (reticle, not
 * selection) and fired upon. ESC or selecting something else cancels.
 */
import { SQ } from "./config.mjs";
import * as H from "./helpers.mjs";
import { attackAction } from "./actions.mjs";
import { coverLevelAgainst, coverBonus, coverLabel } from "./cover.mjs";
import { cancelOverwatchFacing } from "./overwatch.mjs";

const state = { active: false, token: null };
let _forecastEl = null;

export function attackTargetingActive() {
  return state.active;
}

export function attackTargetingToken() {
  return state.token;
}

/** Enter targeting mode for a unit (if it can attack). */
export function enterAttackMode(token) {
  const gate = H.canAct(token, SQ.ATTACK_AP);
  if (!gate.ok) {
    H.notify(gate.reason);
    return;
  }
  cancelOverwatchFacing();
  state.token = token;
  state.active = true;
  document.body.classList.add("com-targeting");
  Hooks.callAll("com:refresh");
}

export function cancelAttackMode() {
  state.active = false;
  state.token = null;
  document.body.classList.remove("com-targeting");
  Hooks.callAll("com:refresh");
}

/**
 * Attack from targeting mode: press Attack without a target, then click an
 * enemy on the canvas. The click marks the enemy with Foundry's targeting
 * reticle instead of the selection the click would normally grant, and the
 * attacker stays controlled.
 */
export async function requestTargetedAttack(worldX, worldY) {
  if (!state.active || !state.token) return;
  const attacker = state.token;

  // Topmost token whose footprint contains the click point.
  const s = canvas.grid.size;
  let target = null;
  for (const t of [...canvas.tokens.placeables].reverse()) {
    if (t.document.hidden) continue;
    const doc = t.document;
    if (worldX >= doc.x && worldX < doc.x + doc.width * s
      && worldY >= doc.y && worldY < doc.y + doc.height * s) {
      target = t;
      break;
    }
  }

  cancelAttackMode();
  if (!target) {
    // A blank click would otherwise release control of the attacker.
    attacker.control({ releaseOthers: true });
    return;
  }
  if (target.id === attacker.id) return;
  // Clicking an ally or a neutral is a selection, not a shot: let Foundry's
  // own handling stand and just leave the mode.
  if (H.sideOf(target) !== H.SIDE.ENEMY) return;

  // Undo the selection the click just made, put the reticle on the victim
  // (visible to all clients) and keep the attacker under control.
  target.release();
  target.setTarget(true, { releaseOthers: true });
  attacker.control({ releaseOthers: true });

  await attackAction(attacker, target);
  // Keep the next press of Attack deterministic: no stale reticle to
  // auto-fire at when the player only means to arm click-targeting again.
  H.clearTargets();
}

export function registerTargeting() {
  Hooks.once("ready", () => {
    _forecastEl = document.createElement("div");
    _forecastEl.id = "com-forecast";
    document.body.appendChild(_forecastEl);
  });

  // Attack forecast: hovering any token shows the controlled unit's odds
  // against it (hit chance, damage, range/LOS warnings).
  Hooks.on("hoverToken", (token, hovered) => {
    if (hovered) showForecast(token);
    else hideForecast();
  });
  Hooks.on("controlToken", () => hideForecast());

  // Click wiring at the DOM level: Foundry's token interaction stops
  // pointer events from bubbling to the stage, so clicks on tokens would
  // never reach a stage listener. Capture-phase DOM listeners see them all.
  Hooks.on("canvasReady", () => {
    const view = H.canvasViewElement();
    if (!view || view.dataset.comTargetingWired) return;
    view.dataset.comTargetingWired = "1";
    let down = null;

    view.addEventListener("pointerdown", (ev) => {
      if (ev.button !== 0) return;
      down = { x: ev.clientX, y: ev.clientY };
    }, true);
    view.addEventListener("pointerup", (ev) => {
      if (ev.button !== 0 || !down) return;
      const dx = ev.clientX - down.x;
      const dy = ev.clientY - down.y;
      down = null;
      if (dx * dx + dy * dy > 64) return; // dragged, not a click
      if (!state.active) return;
      const w = H.worldFromClient(ev.clientX, ev.clientY);
      requestTargetedAttack(w.x, w.y);
    }, true);
  });

  // NOTE: there is deliberately no controlToken cancel here. Clicking a
  // token in Foundry releases the attacker and selects the victim in one
  // gesture — any cancel hooked into that storm would kill the mode before
  // the click could fire. requestTargetedAttack consumes the mode itself,
  // and ally/blank clicks are plain selections that also end it.
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.active) cancelAttackMode();
  });
}

/* -------------------------------------------- */
/* Hover attack forecast                        */
/* -------------------------------------------- */

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[ch]);
}

/** Show the controlled unit's attack odds against a hovered token. */
function showForecast(target) {
  if (!_forecastEl) return;
  const attacker = canvas.tokens.controlled[0] ?? null;
  if (!attacker?.actor || !target?.actor || target.id === attacker.id
    || attacker.actor.system.hp.value <= 0 || target.actor.system.hp.value <= 0) {
    return hideForecast();
  }
  const weapon = H.getEquippedWeapon(attacker.actor);
  const dist = H.gridDistance(attacker, target);
  let line;
  if (dist > weapon.system.range) {
    line = `<span class="com-forecast-bad">${game.i18n.localize("COM.Notif.OutOfRange")}</span>`;
  } else if (!H.hasLOS(H.tokenCenter(attacker), H.tokenCenter(target))) {
    line = `<span class="com-forecast-bad">${game.i18n.localize("COM.Notif.NoLOS")}</span>`;
  } else {
    const coverLevel = coverLevelAgainst(attacker, target);
    const coverPenalty = Number(weapon.system.range) <= 1 ? 0 : coverBonus(coverLevel);
    const chance = Math.clamp(
      attacker.actor.system.aim - target.actor.system.defense - coverPenalty,
      SQ.MIN_HIT,
      SQ.MAX_HIT
    );
    const cls = chance >= 60 ? "com-forecast-good" : chance >= 30 ? "com-forecast-mid" : "com-forecast-bad";
    line = `<span class="${cls}">${game.i18n.localize("COM.Card.HitChance")}: ${chance}%</span>`
      + ` · <span class="com-forecast-dmg">${escapeHtml(weapon.system.damage || "1")}</span>`;
    if (coverLevel > 0) {
      line += ` · <span class="com-forecast-cover">${game.i18n.localize("COM.Card.Cover")}: ${coverLabel(coverLevel)} (−${coverPenalty}%)</span>`;
    }
  }
  _forecastEl.innerHTML =
    `<div class="com-forecast-name">${escapeHtml(target.name)}</div><div class="com-forecast-row">${line}</div>`;

  // Anchor above the hovered token's top edge.
  const anchor = canvas.clientCoordinatesFromCanvas({
    x: target.position.x + target.w / 2,
    y: target.position.y
  });
  _forecastEl.style.left = `${anchor.x}px`;
  _forecastEl.style.top = `${anchor.y}px`;
  _forecastEl.classList.add("com-visible");
}

function hideForecast() {
  _forecastEl?.classList.remove("com-visible");
}

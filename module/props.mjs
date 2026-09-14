/**
 * Cover props: pre-made placeable cover objects (crates, sandbags, barrels,
 * shipping containers). A GM-only palette lists the presets; dragging one
 * onto the scene drops an actorless neutral token carrying a `flags.com.prop`
 * cover level. cover.mjs treats that token's footprint as four cover edges —
 * the same rule flagged walls use — while the rest of the system treats the
 * token like any object: AI ignores it (not hostile), it cannot be shot
 * (no actor, neutral), and its cells block COM pathfinding.
 *
 * Props can be shot from attack targeting mode. Explosive props (the fuel
 * barrel) detonate when hit: everyone within SQ.BARREL_BLAST_RADIUS cells
 * takes SQ.BARREL_BLAST_DAMAGE, and other explosive barrels caught in the
 * blast chain-detonate. Inert props just take the hit.
 */
import { SQ } from "./config.mjs";
import * as H from "./helpers.mjs";
import { shoot, explosion } from "./fx.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Preset props, in palette order. w/h in grid cells, level 1–3. */
const PROPS = {
  crate: { key: "crate", w: 1, h: 1, level: 1 },
  sandbags: { key: "sandbags", w: 1, h: 1, level: 1 },
  barrel: { key: "barrel", w: 1, h: 1, level: 1, explosive: true },
  waterbarrel: { key: "waterbarrel", w: 1, h: 1, level: 1 },
  container: { key: "container", w: 2, h: 1, level: 3 }
};

function propList() {
  return Object.values(PROPS).map((def) => ({
    ...def,
    explosive: !!def.explosive,
    name: game.i18n.localize(`COM.Props.${def.key}`),
    img: `systems/${SQ.id}/assets/props/${def.key}.svg`,
    size: `${def.w}×${def.h}`,
    levelLabel: coverLevelLabel(def.level)
  }));
}

function coverLevelLabel(level) {
  const keys = ["None", "Half", "ThreeQuarter", "Full"];
  return game.i18n.localize(`COM.Cover.Level${keys[level]}`);
}

/* -------------------------------------------- */
/* Prop flags                                   */
/* -------------------------------------------- */

/** Is this token a cover prop (any kind)? */
export function isPropToken(tokenLike) {
  const doc = tokenLike?.document ?? tokenLike;
  return doc?.flags?.[SQ.id]?.prop != null;
}

/** Is this token an explosive prop? Legacy barrels (placed before the flag
 * existed but carrying the red fuel-barrel art) count as explosive. */
export function isExplosiveProp(tokenLike) {
  const doc = tokenLike?.document ?? tokenLike;
  const flags = doc?.flags?.[SQ.id];
  if (!flags || flags.prop == null) return false;
  if (flags.propExplosive != null) return !!flags.propExplosive;
  if (flags.propKey) return flags.propKey === "barrel";
  return String(doc?.texture?.src || "").includes("barrel");
}

function propDef(tokenLike) {
  const doc = tokenLike?.document ?? tokenLike;
  return PROPS[doc?.flags?.[SQ.id]?.propKey] ?? null;
}

/* -------------------------------------------- */
/* Palette window                               */
/* -------------------------------------------- */

let _palette = null;

class PropsPalette extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "com-props",
    tag: "div",
    classes: ["com-props"],
    window: { title: "COM.Props.Title", icon: "fas fa-box-open" },
    position: { width: 340 }
  };

  static PARTS = {
    main: { template: `systems/${SQ.id}/templates/props.html` }
  };

  /** @override */
  _prepareContext(options) {
    return { props: propList(), hint: game.i18n.localize("COM.Props.Hint") };
  }

  /** @override — make every prop card a drag source. */
  async _onRender(context, options) {
    for (const el of this.element.querySelectorAll(".com-prop[draggable]")) {
      el.addEventListener("dragstart", (ev) => {
        ev.dataTransfer.setData(
          "text/plain",
          JSON.stringify({ type: "com-prop", prop: el.dataset.prop })
        );
        ev.dataTransfer.effectAllowed = "copy";
      });
    }
  }
}

/** Show the palette (creating it on first use). */
export function openPropsPalette() {
  _palette ??= new PropsPalette();
  _palette.render({ force: true }).catch((err) => {
    console.error("COM: props palette failed to render", err);
  });
  return _palette;
}

/** Toggle the palette from the launcher button. */
export function togglePropsPalette() {
  if (_palette?.rendered) _palette.close();
  else openPropsPalette();
}

/* -------------------------------------------- */
/* Placing                                      */
/* -------------------------------------------- */

/**
 * Turn a canvas drop into an actorless prop token, centered on the cursor
 * and snapped to the grid so footprints line up with cells.
 */
async function placeProp(data) {
  const def = PROPS[data.prop];
  if (!def || !canvas.ready || !canvas.scene) return;
  if (!Number.isFinite(data.x) || !Number.isFinite(data.y)) {
    console.warn("COM: prop drop without coordinates", data);
    return;
  }
  const size = canvas.grid.size;
  const topLeft = {
    x: data.x - (def.w * size) / 2,
    y: data.y - (def.h * size) / 2
  };
  // v14: getSnappedPoint requires an explicit snapping mode (older cores
  // snapped from the point alone). TOP_LEFT_VERTEX aligns the token's
  // top-left with a grid intersection so multi-cell footprints cover cells.
  const snapMode = CONST.GRID_SNAPPING_MODES?.TOP_LEFT_VERTEX ?? 0;
  const at = canvas.grid.getSnappedPoint(topLeft, snapMode ? { mode: snapMode } : undefined);
  const name = game.i18n.localize(`COM.Props.${def.key}`);
  await canvas.scene.createEmbeddedDocuments("Token", [{
    name,
    x: at.x,
    y: at.y,
    width: def.w,
    height: def.h,
    texture: { src: `systems/${SQ.id}/assets/props/${def.key}.svg` },
    disposition: CONST.TOKEN_DISPOSITIONS.NEUTRAL,
    sight: { enabled: false },
    displayBars: CONST.TOKEN_DISPLAY_MODES.NONE,
    displayName: CONST.TOKEN_DISPLAY_MODES.HOVER,
    flags: { [SQ.id]: { prop: def.level, propKey: def.key, propExplosive: !!def.explosive } }
  }]);
  ui.notifications.info(game.i18n.format("COM.Props.Placed", { name }));
}

/* -------------------------------------------- */
/* Shooting props                               */
/* -------------------------------------------- */

/**
 * Resolve a shot from a unit at a prop token. Props are stationary: the hit
 * chance is the shooter's aim plus a fixed bonus, with no defense or cover.
 * A hit on an explosive prop detonates it; inert props just absorb the shot.
 */
export async function shootProp(attacker, prop) {
  if (!attacker?.actor || !isPropToken(prop)) return;
  const aSys = attacker.actor.system;
  const weapon = H.getEquippedWeapon(attacker.actor);
  const melee = Number(weapon.system.range) <= 1;

  const gate = H.canAct(attacker, SQ.ATTACK_AP);
  if (!gate.ok) {
    H.notify(gate.reason);
    return;
  }
  if (H.gridDistance(attacker, prop) > weapon.system.range) {
    H.notify("COM.Notif.OutOfRange");
    return;
  }
  if (!H.hasLOS(H.tokenCenter(attacker), H.tokenCenter(prop))) {
    H.notify("COM.Notif.NoLOS");
    return;
  }

  const chance = Math.clamp(aSys.aim + SQ.PROP_HIT_BONUS, SQ.MIN_HIT, SQ.MAX_HIT);
  const hitRoll = await new Roll("1d100").evaluate();
  const hit = hitRoll.total <= chance;

  await shoot({ attacker, target: prop, hit, melee });
  await spendPropShotAP(attacker);

  if (!hit) {
    await H.notify("COM.Notif.PropMissed", "info");
    return;
  }

  const doc = prop.document ?? prop;
  if (isExplosiveProp(prop)) {
    await detonate(prop);
  } else {
    await H.notify("COM.Notif.PropInert", "info");
  }
  await ChatMessage.create({
    user: game.userId,
    speaker: ChatMessage.getSpeaker({ token: attacker.document ?? attacker }),
    content: `<div class="com-prop-shot">${game.i18n.format(hit ? "COM.PropShot.Hit" : "COM.PropShot.Miss", {
      attacker: attacker.name,
      prop: doc.name
    })}</div>`,
    flags: { [SQ.id]: { type: "prop-shot" } }
  });
}

async function spendPropShotAP(token) {
  if (!H.activeCombat()) return;
  const actor = token?.actor;
  if (!actor) return;
  const newValue = Math.max(0, actor.system.ap.value - SQ.ATTACK_AP);
  await actor.update({ "system.ap.value": newValue });
}

/* -------------------------------------------- */
/* Explosions                                   */
/* -------------------------------------------- */

/** Barrel detonations currently in flight (token ids), guarding chains. */
const _detonating = new Set();

/**
 * Detonate an explosive prop: flash, blast damage to everything in radius,
 * chain-detonate other explosive props caught in the blast, then remove the
 * barrel. Safe to call with a Token placeable or TokenDocument.
 */
export async function detonate(prop) {
  const doc = prop?.document ?? prop;
  if (!doc || _detonating.has(doc.id)) return;
  _detonating.add(doc.id);
  try {
    const placeable = canvas.tokens?.get(doc.id) ?? prop;
    const center = H.tokenCenter(placeable);
    const radius = SQ.BARREL_BLAST_RADIUS;

    await explosion({ x: center.x, y: center.y, radius });

    const dmgRoll = await new Roll(SQ.BARREL_BLAST_DAMAGE).evaluate();
    const victims = [];
    const barrelCells = H.tokenCells(placeable).map(parseCellKey);

    for (const victim of canvas.tokens.placeables) {
      if (victim.id === doc.id || !victim.actor) continue;
      if (victim.actor.system.hp.value <= 0) continue;
      const cells = H.tokenCells(victim).map(parseCellKey);
      const caught = cells.some((c) => barrelCells.some((b) =>
        Math.max(Math.abs(c[0] - b[0]), Math.abs(c[1] - b[1])) <= radius));
      if (!caught) continue;
      const hp = victim.actor.system.hp.value;
      const newHp = Math.max(0, hp - dmgRoll.total);
      await victim.actor.update({ "system.hp.value": newHp });
      if (newHp <= 0) {
        await H.setOverlay(victim.actor, SQ.DOWNED_EFFECT, SQ.DOWNED_ICON, true);
        await H.setOverwatch(victim.actor, false);
        await H.markDefeated(victim, true);
      }
      victims.push({ token: victim, oldHp: hp, newHp });
    }

    await renderExplosionCard(doc.name, dmgRoll, victims);

    // Chain reaction: other explosive props caught in the blast go up too.
    const chained = canvas.tokens.placeables.filter((t) =>
      t.id !== doc.id && !_detonating.has(t.id) && isExplosiveProp(t) && cellsInBlast(t, barrelCells, radius));
    for (const next of chained) {
      await new Promise((r) => setTimeout(r, 420));
      const stillThere = canvas.tokens.get(next.id);
      if (stillThere) await detonate(stillThere);
    }

    await canvas.scene?.deleteEmbeddedDocuments("Token", [doc.id]);
  } catch (err) {
    console.error("COM: prop detonation failed", err);
  } finally {
    _detonating.delete(doc.id);
  }
}

function parseCellKey(key) {
  return String(key).split(",").map(Number);
}

function cellsInBlast(token, barrelCells, radius) {
  return H.tokenCells(token).map(parseCellKey).some((c) => barrelCells.some((b) =>
    Math.max(Math.abs(c[0] - b[0]), Math.abs(c[1] - b[1])) <= radius));
}

async function renderExplosionCard(name, dmgRoll, victims) {
  const rows = victims.map((v) =>
    `<li>${escapeHtml(v.token.name)}: ${v.oldHp} → <strong>${v.newHp}</strong> HP${v.newHp <= 0 ? " — " + game.i18n.localize("COM.Card.Down") : ""}</li>`
  ).join("");
  await ChatMessage.create({
    user: game.userId,
    flavor: game.i18n.localize("COM.Explosion.Title"),
    content: `<div class="com-explosion"><h4>💥 ${escapeHtml(name)} — ${game.i18n.localize("COM.Explosion.Title")}</h4>
      <p>${game.i18n.format("COM.Explosion.Damage", { damage: dmgRoll.total, formula: SQ.BARREL_BLAST_DAMAGE })}</p>
      ${victims.length ? `<ul>${rows}</ul>` : `<p>${game.i18n.localize("COM.Explosion.NoVictims")}</p>`}</div>`,
    rolls: [dmgRoll],
    flags: { [SQ.id]: { type: "explosion" } }
  });
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[ch]);
}

/* -------------------------------------------- */
/* Registration                                 */
/* -------------------------------------------- */

export function registerProps() {
  // Older cores whitelist canvas drops by type before calling the
  // dropCanvasData hook (v13.340+ fires the hook regardless); register ours
  // so the drop is recognized everywhere.
  const dropTypes = CONFIG.Canvas?.dropTypes;
  if (dropTypes && !dropTypes["com-prop"]) {
    dropTypes["com-prop"] = { label: "COM Cover Prop" };
  }

  // Consume our custom drag data before core tries to make sense of it.
  Hooks.on("dropCanvasData", (canvasObj, data) => {
    if (data?.type !== "com-prop" || !game.user.isGM) return;
    placeProp(data).catch((err) => console.error("COM: could not place prop", err));
    return false;
  });

  Hooks.once("ready", () => {
    if (!game.user.isGM) return;
    const btn = document.createElement("button");
    btn.id = "com-props-open";
    btn.title = game.i18n.localize("COM.Props.Open");
    btn.innerHTML = '<i class="fas fa-box-open"></i>';
    btn.addEventListener("click", () => togglePropsPalette());
    document.body.appendChild(btn);
  });
}

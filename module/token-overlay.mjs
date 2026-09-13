/**
 * Under-token status overlay: a small HP bar with AP pips rendered
 * directly beneath every unit token on the canvas (XCOM-style).
 *
 * The overlay is a PIXI container attached to each Token placeable on
 * draw; its contents are only redrawn when HP/AP actually change.
 */
import { SQ } from "./config.mjs";
import * as H from "./helpers.mjs";

const HP_COLOR = 0xe06c5a;
const AP_COLOR = 0x7fd94c;
const AP_EMPTY = 0x141414;

export function registerTokenOverlay() {
  Hooks.on("drawToken", (token) => {
    if (!token.actor) return;
    // Replace Foundry's large rotating turn marker with the subtle
    // indicator drawn below. One-time per-token migration.
    if (token.document.turnMarker?.mode !== CONST.TOKEN_TURN_MARKER_MODES.DISABLED) {
      token.document.update({ "turnMarker.mode": CONST.TOKEN_TURN_MARKER_MODES.DISABLED })
        .catch(() => { /* non-fatal */ });
    }
    addOverlay(token);
    drawOverlay(token, true);
  });

  Hooks.on("refreshToken", (token) => {
    if (!token.comOverlay || !token.actor) return;
    positionOverlay(token);
    drawOverlay(token, false);
  });

  // AP/HP live on the actor; make sure every token of that actor redraws.
  Hooks.on("updateActor", (actor) => {
    for (const token of actor.getActiveTokens()) {
      if (token.comOverlay) drawOverlay(token, true);
    }
  });

  // The active-turn indicator moves with the combat turn.
  Hooks.on("updateCombat", () => {
    for (const token of canvas.tokens.placeables) {
      if (token.comOverlay) drawOverlay(token, true);
    }
  });
}

/* -------------------------------------------- */

function addOverlay(token) {
  if (token.comOverlay) {
    token.comOverlay.destroy({ children: true });
    token.comOverlay = null;
  }
  const g = new PIXI.Graphics();
  token.comOverlay = g;
  token.addChild(g);
  positionOverlay(token);
}

function positionOverlay(token) {
  const s = canvas.dimensions.uiScale || 1;
  token.comOverlay.position.set(0, token.h + 4 * s);
}

/**
 * Redraw the HP bar + AP pips if the underlying values changed.
 * @param {Token} token
 * @param {boolean} force  Redraw even when the cached state matches.
 */
function drawOverlay(token, force) {
  const sys = token.actor?.system;
  if (!sys || !token.comOverlay) return;

  const state = `${sys.hp.value}/${sys.hp.max}|${sys.ap.value}/${sys.ap.max}`;
  if (!force && token._comOverlayState === state) return;
  token._comOverlayState = state;

  const g = token.comOverlay;
  g.clear();

  // Downed units are already marked by the skull overlay — no clutter.
  if (sys.hp.value <= 0) return;

  const s = canvas.dimensions.uiScale || 1;
  const w = token.w;

  // HP bar
  const bh = 7 * s;
  g.lineStyle(s, 0x000000, 1.0);
  g.beginFill(0x000000, 0.55).drawRoundedRect(0, 0, w, bh, 3 * s);
  const pct = Math.clamp(sys.hp.value, 0, sys.hp.max) / sys.hp.max;
  g.beginFill(HP_COLOR, 1.0)
    .drawRoundedRect(0.5 * s, 0.5 * s, Math.max(0, (w - s) * pct), bh - s, 2 * s);

  // AP pips, centered under the bar
  const r = 4.75 * s;
  const gap = 3.5 * s;
  const total = Math.max(1, Number(sys.ap.max) || 0);
  const rowWidth = total * (2 * r) + (total - 1) * gap;
  let px = (w - rowWidth) / 2 + r;
  const py = bh + 6 * s;
  for (let i = 0; i < total; i++) {
    const filled = i < sys.ap.value;
    g.lineStyle(s, filled ? 0x000000 : AP_COLOR, 1.0);
    g.beginFill(filled ? AP_COLOR : AP_EMPTY, filled ? 1.0 : 0.85)
      .drawCircle(px, py, r);
    px += 2 * r + gap;
  }

  // Active-turn indicator: a stationary green border around the token square.
  if (H.isActiveCombatant(token)) {
    g.endFill(); // stop the pip fill from leaking into the strokes
    const o = 1.5 * s; // slight outset so the border reads outside the art
    const x = -o;
    const y = -(token.h + 4 * s) - o; // overlay origin sits below the token
    const rw = w + 2 * o;
    const rh = token.h + 2 * o;
    g.lineStyle(3.5 * s, 0x000000, 0.9).drawRoundedRect(x, y, rw, rh, 6 * s);
    g.lineStyle(1.75 * s, AP_COLOR, 1.0).drawRoundedRect(x, y, rw, rh, 6 * s);
  }
}

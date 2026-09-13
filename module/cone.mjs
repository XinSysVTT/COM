/**
 * Overwatch cone geometry and display.
 *
 * A cone is anchored on the watcher's token center, points along a stored
 * {x, y} world-space direction, opens at SQ.OVERWATCH_CONE_ANGLE (full
 * angle) and reaches out to the equipped weapon's range in grid cells.
 * Walls cut the cone per tile through the usual line-of-sight test.
 *
 * The stored direction lives in the `flags.com.overwatchDir` actor flag so
 * it syncs to every client; a missing direction (e.g. the sheet checkbox)
 * falls back to a full 360° coverage.
 */
import { SQ } from "./config.mjs";
import * as H from "./helpers.mjs";

/* -------------------------------------------- */
/* Geometry                                     */
/* -------------------------------------------- */

/** Coerce a stored direction into a unit vector, or null for 360°. */
function normalizeDir(dir) {
  if (!dir || !Number.isFinite(dir.x) || !Number.isFinite(dir.y)) return null;
  const len = Math.hypot(dir.x, dir.y);
  if (len < 1e-6) return null;
  return { x: dir.x / len, y: dir.y / len };
}

/** Unit vector from the token's center toward a world point (null if too close). */
export function dirToward(token, worldX, worldY) {
  const c = H.tokenCenter(token);
  return normalizeDir({ x: worldX - c.x, y: worldY - c.y });
}

/** Unit vector along the token's rotation (Foundry: degrees clockwise from north). */
export function dirFromRotation(token) {
  const deg = token?.document?.rotation ?? 0;
  const rad = (deg - 90) * (Math.PI / 180);
  return { x: Math.cos(rad), y: Math.sin(rad) };
}

/**
 * Cone for a token. Pure geometry — callers decide whether the unit is
 * actually on overwatch. An explicit `dir` overrides the stored one
 * (used by the facing preview).
 */
export function coneFor(token, { dir } = {}) {
  if (!token?.actor) return null;
  const weapon = H.getEquippedWeapon(token.actor);
  const stored = dir !== undefined ? dir : token.actor.getFlag(SQ.id, "overwatchDir");
  const c = H.tokenCenter(token);
  return {
    cx: c.x,
    cy: c.y,
    dir: normalizeDir(stored),
    radius: Math.max(1, Number(weapon.system.range) || 1),
    halfAngle: (SQ.OVERWATCH_CONE_ANGLE / 2) * (Math.PI / 180)
  };
}

/** Is a world point inside the cone's reach and opening? (No LOS check.) */
export function pointInCone(cone, px, py) {
  const s = canvas.grid.size;
  const dx = px - cone.cx;
  const dy = py - cone.cy;
  const dist = Math.hypot(dx, dy) / s;
  if (dist > cone.radius + 1e-9 || dist < 1e-6) return false;
  if (!cone.dir) return true; // 360° fallback
  const dot = (dx * cone.dir.x + dy * cone.dir.y) / Math.hypot(dx, dy);
  return Math.acos(Math.clamp(dot, -1, 1)) <= cone.halfAngle + 1e-9;
}

/**
 * Is a world point a valid trigger spot for this watcher: inside the cone,
 * with line of sight, and not on the watcher's own footprint?
 */
export function pointCovered(watcher, cone, px, py) {
  if (!pointInCone(cone, px, py)) return false;
  const s = canvas.grid.size;
  const doc = watcher.document ?? watcher;
  if (px >= doc.x && px < doc.x + doc.width * s && py >= doc.y && py < doc.y + doc.height * s) {
    return false;
  }
  return H.hasLOS({ x: cone.cx, y: cone.cy }, { x: px, y: py });
}

/** Grid cells whose center lies in the cone (LOS-checked), for highlighting. */
export function coneCells(watcher, cone) {
  const s = canvas.grid.size;
  const r = Math.ceil(cone.radius);
  const origin = H.cellAt(cone.cx, cone.cy);
  const key = `${watcher.id}|${cone.cx.toFixed(1)},${cone.cy.toFixed(1)}`
    + `|${cone.dir ? `${cone.dir.x.toFixed(3)},${cone.dir.y.toFixed(3)}` : "360"}|${cone.radius}|${s}`;
  const cached = _cellCache.get(key);
  if (cached) return cached;

  const self = new Set(H.tokenCells(watcher));
  const cells = [];
  for (let i = origin.i - r; i <= origin.i + r; i++) {
    for (let j = origin.j - r; j <= origin.j + r; j++) {
      if (self.has(H.cellKey(i, j))) continue;
      if (!H.inScene(i, j)) continue;
      const c = H.cellCenter(i, j);
      if (!pointInCone(cone, c.x, c.y)) continue;
      if (!H.hasLOS({ x: cone.cx, y: cone.cy }, c)) continue;
      cells.push({ i, j });
    }
  }
  _cellCache.set(key, cells);
  return cells;
}

/* -------------------------------------------- */
/* Cell cache                                   */
/* -------------------------------------------- */

const _cellCache = new Map();

/** Forget cached cone cells (walls changed or a new scene loaded). */
export function invalidateConeCache() {
  _cellCache.clear();
}

/* -------------------------------------------- */
/* Display                                      */
/* -------------------------------------------- */

function drawCells(name, watcher, cone) {
  H.clearHighlightLayer(name);
  if (!H.ensureHighlightLayer(name)) return;
  for (const cell of coneCells(watcher, cone)) {
    H.highlightCell(name, cell.i, cell.j, SQ.COLOR_OVERWATCH);
  }
}

/** Draw the persistent overwatch cone of a token (if it is on overwatch). */
export function drawCone(token) {
  if (!token?.actor?.system?.overwatch) return;
  const cone = coneFor(token);
  if (cone) drawCells(SQ.CONE_HIGHLIGHT_NAME, token, cone);
}

/** Remove the persistent cone highlight. */
export function clearCone() {
  H.clearHighlightLayer(SQ.CONE_HIGHLIGHT_NAME);
}

/**
 * Redraw the persistent cone for the currently controlled token: shown
 * while one of your overwatching units is selected, gone otherwise.
 */
export function refreshOverwatchCones() {
  if (!canvas.ready) return;
  const token = canvas.tokens.controlled[0] ?? null;
  clearCone();
  if (token?.actor?.system?.overwatch) drawCone(token);
}

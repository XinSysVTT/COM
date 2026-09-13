/**
 * Shared helpers: grid math, sides, wall collision, action permissions,
 * and the canvas highlight layer used to draw the movement range.
 *
 * Foundry V14 conventions used here:
 * - Grid coordinates are {i, j} where i = row (y index) and j = column (x index).
 * - Wall collision tests run through CONFIG.Canvas.polygonBackends[type].testCollision.
 * - The movement-range highlight layer lives on `canvas.interface.grid` (GridLayer)
 *   and `highlightPosition` expects the pixel top-left corner of the cell.
 */
import { SQ } from "./config.mjs";

export const SIDE = { PLAYER: "player", ENEMY: "enemy" };

/* -------------------------------------------- */
/* Sides & combat state                         */
/* -------------------------------------------- */

/**
 * A combatant's side is derived from its token disposition:
 * HOSTILE tokens form the enemy side, everything else the player side.
 */
export function sideOf(tokenLike) {
  const doc = tokenLike?.document ?? tokenLike;
  return doc?.disposition === CONST.TOKEN_DISPOSITIONS.HOSTILE ? SIDE.ENEMY : SIDE.PLAYER;
}

export function activeCombat() {
  return game.combat?.active ? game.combat : null;
}

export function activeCombatant() {
  return activeCombat()?.combatant ?? null;
}

export function isActiveCombatant(token) {
  return activeCombatant()?.token?.id === token?.id;
}

/** The token of the unit whose turn it currently is, or null. */
export function activeToken() {
  return activeCombatant()?.token?.object ?? null;
}

/** The Combatant belonging to a token in the active combat, or null. */
export function combatantForToken(token) {
  const combat = game.combat;
  if (!combat || !token) return null;
  return combat.combatants.find((c) => c.tokenId === token.id) ?? null;
}

/** Toggle the combatant's defeated state (grays it out in the tracker). */
export async function markDefeated(token, defeated) {
  const combatant = combatantForToken(token);
  if (combatant && combatant.defeated !== defeated) {
    await combatant.update({ defeated });
  }
}

/**
 * Set or clear a unit's overwatch state in one place: the flag the rules
 * read, the stored cone direction (an {x, y} world-space vector), and the
 * overlay icon. `dir` is ignored when clearing.
 */
export async function setOverwatch(actor, active, dir = null) {
  if (!actor) return;
  await actor.update({
    "system.overwatch": !!active,
    "flags.com.overwatchDir": active ? (dir ?? null) : null
  });
  await setOverlay(actor, SQ.OVERWATCH_EFFECT, SQ.OVERWATCH_ICON, active);
}

/**
 * Show or remove a named overlay icon on all tokens of an actor.
 * V14 renders overlay icons from ActiveEffects with `flags.core.overlay`.
 */
export async function setOverlay(actor, name, icon, active) {
  if (!actor) return;
  const existing = actor.effects.find((e) => e.name === name && e.getFlag("core", "overlay"));
  const isActive = !!existing;
  if (active === undefined) active = !isActive;
  if (active && !isActive) {
    await actor.createEmbeddedDocuments("ActiveEffect", [{
      name,
      img: icon,
      showIcon: CONST.ACTIVE_EFFECT_SHOW_ICON.ALWAYS,
      statuses: [],
      flags: { core: { overlay: true } }
    }]);
  } else if (!active && isActive) {
    // Concurrent clears (turn end + combat teardown) can race the same
    // effect — a lost delete is fine.
    await actor.deleteEmbeddedDocuments("ActiveEffect", [existing.id]).catch(() => { });
  }
}

/* -------------------------------------------- */
/* Grid math (square grids)                     */
/* -------------------------------------------- */

export function isSquareGrid() {
  return canvas.grid?.isSquare === true;
}

/** World position to grid cell {i: row, j: col}. */
export function cellAt(px, py) {
  const s = canvas.grid.size;
  return { i: Math.floor(py / s), j: Math.floor(px / s) };
}

export function cellCenter(i, j) {
  const s = canvas.grid.size;
  return { x: (j + 0.5) * s, y: (i + 0.5) * s };
}

export function cellTopLeft(i, j) {
  const s = canvas.grid.size;
  return { x: j * s, y: i * s };
}

export function cellKey(i, j) {
  return `${i},${j}`;
}

/** Grid cell of the token's top-left corner. */
export function tokenOriginCell(token) {
  const doc = token.document ?? token;
  return cellAt(doc.x, doc.y);
}

/** Center point of a token (accounting for footprint size). */
export function tokenCenter(token) {
  const doc = token.document ?? token;
  const s = canvas.grid.size;
  return {
    x: doc.x + (doc.width * s) / 2,
    y: doc.y + (doc.height * s) / 2
  };
}

/** Grid cell keys ("i,j") covered by a single token's footprint. */
export function tokenCells(token) {
  const doc = token?.document ?? token;
  if (!doc) return [];
  const s = canvas.grid.size;
  const i0 = Math.floor(doc.y / s);
  const j0 = Math.floor(doc.x / s);
  const w = Math.max(1, Math.round(doc.width ?? 1));
  const h = Math.max(1, Math.round(doc.height ?? 1));
  const cells = [];
  for (let di = 0; di < h; di++) {
    for (let dj = 0; dj < w; dj++) {
      cells.push(cellKey(i0 + di, j0 + dj));
    }
  }
  return cells;
}

/** All grid cells occupied by every token on the canvas, except `exclude`. */
export function occupiedCells(exclude) {
  const set = new Set();
  for (const t of canvas.tokens.placeables) {
    if (exclude && t.id === exclude.id) continue;
    for (const key of tokenCells(t)) set.add(key);
  }
  return set;
}

/** Is the center of this cell inside the scene bounds? */
export function inScene(i, j) {
  const c = cellCenter(i, j);
  const rect = canvas.dimensions?.sceneRect;
  if (rect) return rect.contains(c.x, c.y);
  const dims = canvas.dimensions;
  return c.x >= 0 && c.y >= 0 && c.x <= (dims?.sceneWidth ?? 0) && c.y <= (dims?.sceneHeight ?? 0);
}

/** Distance in grid cells between two tokens (center to center). */
export function gridDistance(a, b) {
  const ca = tokenCenter(a);
  const cb = tokenCenter(b);
  return Math.ceil(Math.hypot(cb.x - ca.x, cb.y - ca.y) / canvas.grid.size);
}

/* -------------------------------------------- */
/* Walls & vision                               */
/* -------------------------------------------- */

/** Test a ray against the scene's walls for the given restriction type. */
function rayCollides(a, b, type) {
  try {
    return !!CONFIG.Canvas.polygonBackends[type].testCollision(a, b, { type, mode: "any" });
  } catch {
    return type === "move"; // fail closed for movement, open for vision
  }
}

/**
 * Movement-blocking wall segments as [x1,y1,x2,y2]. Cached because the
 * Dijkstra range search tests thousands of edges — a polygon sweep per
 * edge would take seconds on a walled scene.
 */
let _wallCache = null;
const _edgeCache = new Map();

function blockingWalls() {
  if (_wallCache) return _wallCache;
  _wallCache = canvas.walls.placeables
    .filter((w) => {
      const doc = w.document;
      if (doc.move === CONST.WALL_MOVEMENT_TYPES.NONE) return false;
      if (doc.door && doc.ds === CONST.WALL_DOOR_STATES.OPEN) return false;
      return true;
    })
    .map((w) => w.document.c);
  return _wallCache;
}

/** Forget cached wall/edge data (walls created, moved, or doors toggled). */
export function invalidateWallCache() {
  _wallCache = null;
  _edgeCache.clear();
}

/** Does a wall block movement between two world points? */
export function edgeBlocked(a, b) {
  const key = `${a.x},${a.y}|${b.x},${b.y}`;
  const cached = _edgeCache.get(key);
  if (cached !== undefined) return cached;
  let blocked = false;
  for (const c of blockingWalls()) {
    if (foundry.utils.lineSegmentIntersection(a, b, { x: c[0], y: c[1] }, { x: c[2], y: c[3] })) {
      blocked = true;
      break;
    }
  }
  _edgeCache.set(key, blocked);
  return blocked;
}

/** Is there unblocked vision between two world points? */
export function hasLOS(a, b) {
  return !rayCollides(a, b, "sight");
}

/* -------------------------------------------- */
/* Permissions                                  */
/* -------------------------------------------- */

/**
 * Can the current user perform an action costing `cost` AP with this token?
 * Returns { ok, reason } where reason is a localization key.
 */
export function canAct(token, cost) {
  if (!token?.actor) return { ok: false, reason: "COM.Notif.NoActor" };
  if (token.actor.system.hp.value <= 0) return { ok: false, reason: "COM.Notif.Downed" };
  if (!(game.user.isGM || token.isOwner)) return { ok: false, reason: "COM.Notif.NotOwner" };
  if (activeCombat()) {
    if (!isActiveCombatant(token)) return { ok: false, reason: "COM.Notif.NotYourTurn" };
    if (token.actor.system.ap.value < cost) return { ok: false, reason: "COM.Notif.NoAP" };
  }
  return { ok: true };
}

/** Clear the current user's targeting reticles. */
export function clearTargets() {
  for (const t of [...game.user.targets]) {
    t.setTarget(false, { releaseOthers: false });
  }
}

/**
 * The PIXI view element every canvas pointer event lands on. Listening
 * here (DOM level) catches clicks on tokens too — Foundry's token
 * interaction stops those from propagating up to the stage.
 */
export function canvasViewElement() {
  return canvas.app?.view
    ?? document.querySelector("#board canvas")
    ?? document.querySelector("canvas");
}

/** World-space coordinates for a client (viewport) pointer position. */
export function worldFromClient(clientX, clientY) {
  const vp = canvas.scene?._viewPosition ?? {};
  const scale = vp.scale ?? 1;
  return {
    x: (vp.x ?? 0) + (clientX - innerWidth / 2) / scale,
    y: (vp.y ?? 0) + (clientY - innerHeight / 2) / scale
  };
}

/** First equipped weapon, or an unarmed fallback. */
export function getEquippedWeapon(actor) {
  const item = actor.items.find((i) => i.type === "weapon" && i.system.equipped);
  if (item) return { name: item.name, system: item.system, item };
  return {
    name: game.i18n.localize("COM.Weapon.Unarmed"),
    system: { damage: "1", range: 1, equipped: true }
  };
}

export function notify(reasonKey, type = "warn") {
  if (!reasonKey) return;
  ui.notifications[type]?.(game.i18n.localize(reasonKey));
}

/* -------------------------------------------- */
/* Canvas highlight layer (movement range)      */
/* -------------------------------------------- */

/** Create (or return the existing) named highlight layer, or null. */
export function ensureHighlightLayer(name) {
  const gridLayer = canvas.interface?.grid;
  if (typeof gridLayer?.addHighlightLayer !== "function") return null;
  try {
    return gridLayer.addHighlightLayer(name) ?? null;
  } catch {
    return null;
  }
}

/** Highlight one grid cell (i = row, j = col) with a color. */
export function highlightCell(name, i, j, color) {
  const gridLayer = canvas.interface?.grid;
  if (typeof gridLayer?.highlightPosition !== "function") return;
  const tl = cellTopLeft(i, j);
  try {
    gridLayer.highlightPosition(name, {
      x: tl.x,
      y: tl.y,
      color,
      border: color,
      alpha: 0.35
    });
  } catch { /* best effort */ }
}

/** Clear the drawings of a named highlight layer (keeps the layer). */
export function clearHighlightLayer(name) {
  const gridLayer = canvas.interface?.grid;
  try {
    gridLayer?.clearHighlightLayer?.(name);
  } catch { /* best effort */ }
}

/** Remove a named highlight layer entirely. */
export function destroyHighlightLayer(name) {
  const gridLayer = canvas.interface?.grid;
  try {
    gridLayer?.destroyHighlightLayer?.(name);
  } catch { /* best effort */ }
}

/**
 * Click-to-move: computes the reachable range with a Dijkstra shortest-path
 * search over the grid (walls and other tokens block, diagonals cost 1.5),
 * highlights it on the canvas (green = 1 AP move, amber = 2 AP dash), and
 * moves the token along the cheapest found path when the player clicks a
 * highlighted tile.
 */
import { SQ } from "./config.mjs";
import * as H from "./helpers.mjs";
import { spendAP, setPendingMovePath, clearPendingMovePath } from "./actions.mjs";
import { cancelOverwatchFacing } from "./overwatch.mjs";

const state = {
  active: false,
  token: null,
  /** Map<cellKey, {i, j, dist, cost, prev}> */
  reachable: new Map()
};

export function moveModeActive() {
  return state.active;
}

export function moveModeToken() {
  return state.token;
}

/* -------------------------------------------- */
/* Mode control                                 */
/* -------------------------------------------- */

/** Toggle move mode for a token. */
export function toggleMoveMode(token) {
  if (state.active && state.token?.id === token?.id) {
    cancelMoveMode();
    return;
  }
  enterMoveMode(token);
}

export function enterMoveMode(token) {
  const gate = H.canAct(token, SQ.MOVE_AP);
  if (!gate.ok) {
    H.notify(gate.reason);
    return;
  }
  cancelOverwatchFacing();
  state.token = token;
  state.reachable = computeReachable(token);
  if (!state.reachable.size) {
    H.notify("COM.Notif.NoAP");
    state.token = null;
    return;
  }
  state.active = true;
  drawHighlights();
  Hooks.callAll("com:refresh");
}

export function cancelMoveMode() {
  state.active = false;
  state.token = null;
  state.reachable.clear();
  H.clearHighlightLayer(SQ.HIGHLIGHT_NAME);
  Hooks.callAll("com:refresh");
}

/* -------------------------------------------- */
/* Reachability                                 */
/* -------------------------------------------- */

/**
 * Dijkstra from the token's origin cell. Cells are 8-connected: straight
 * steps cost 1, diagonals 1.5 — so highlighted routes are always the
 * quickest way to a tile. Movement cannot pass through walls or through
 * cells occupied by other tokens. Moving `speed` cells of distance costs
 * 1 AP, so cost = ceil(dist / speed).
 */
export function computeReachable(token) {
  const result = new Map();
  if (!token?.actor) return result;

  if (!H.isSquareGrid()) {
    H.notify("SQ.Notif.HexUnsupported");
    return result;
  }

  const sys = token.actor.system;
  const apBudget = H.activeCombat() ? sys.ap.value : sys.ap.max;
  const speed = Math.max(1, Number(sys.speed) || 1);
  const budget = speed * Math.max(0, apBudget);
  if (budget <= 0) return result;

  const origin = H.tokenOriginCell(token);
  const startKey = H.cellKey(origin.i, origin.j);
  const occupied = H.occupiedCells(token);

  const dist = new Map([[startKey, 0]]);
  const prev = new Map();
  const open = [{ i: origin.i, j: origin.j, d: 0 }];

  while (open.length) {
    open.sort((a, b) => a.d - b.d); // frontier is small; fine at this scale
    const cur = open.shift();
    const curKey = H.cellKey(cur.i, cur.j);
    if (cur.d > (dist.get(curKey) ?? Infinity)) continue; // stale queue entry
    if (cur.d >= budget) continue; // any further step would exceed budget

    for (const n of gridNeighbors(cur)) {
      const nKey = H.cellKey(n.i, n.j);
      if (occupied.has(nKey)) continue;
      if (!H.inScene(n.i, n.j)) continue;
      const diagonal = n.i !== cur.i && n.j !== cur.j;
      const step = diagonal ? 1.5 : 1;
      const nd = cur.d + step;
      if (nd > budget) continue;
      // Relax only on strict improvement — otherwise re-pushes can ratchet
      // distances upward forever (soft lock on the main thread).
      const existing = dist.get(nKey);
      if (existing !== undefined && nd >= existing) continue;
      if (H.edgeBlocked(H.cellCenter(cur.i, cur.j), H.cellCenter(n.i, n.j))) continue;
      dist.set(nKey, nd);
      prev.set(nKey, curKey);
      open.push({ i: n.i, j: n.j, d: nd });
    }
  }

  for (const [key, d] of dist) {
    if (key === startKey) continue;
    const [i, j] = key.split(",").map(Number);
    result.set(key, {
      i,
      j,
      dist: d,
      cost: Math.min(Math.ceil(d / speed), Math.max(1, apBudget)),
      prev: prev.get(key) ?? null
    });
  }
  return result;
}

function gridNeighbors({ i, j }) {
  return [
    { i: i + 1, j },
    { i: i - 1, j },
    { i, j: j + 1 },
    { i, j: j - 1 },
    { i: i + 1, j: j + 1 },
    { i: i + 1, j: j - 1 },
    { i: i - 1, j: j + 1 },
    { i: i - 1, j: j - 1 }
  ];
}

/* -------------------------------------------- */
/* Highlights                                   */
/* -------------------------------------------- */

function drawHighlights() {
  H.clearHighlightLayer(SQ.HIGHLIGHT_NAME);
  if (!H.ensureHighlightLayer(SQ.HIGHLIGHT_NAME)) return;
  for (const cell of state.reachable.values()) {
    const color = cell.cost <= 1 ? SQ.COLOR_MOVE : SQ.COLOR_DASH;
    H.highlightCell(SQ.HIGHLIGHT_NAME, cell.i, cell.j, color);
  }
}

/* -------------------------------------------- */
/* Click-to-move                                */
/* -------------------------------------------- */

/** Attempt to move the active move-mode token to a world position. */
export async function requestMoveTo(worldX, worldY) {
  if (!state.active || !state.token) return;
  const token = state.token;
  const cell = H.cellAt(worldX, worldY);
  const entry = state.reachable.get(H.cellKey(cell.i, cell.j));
  if (!entry) return; // clicked outside the reachable range

  const cost = entry.cost;
  const path = reconstructPath(entry); // capture before the map is cleared
  cancelMoveMode();

  // Let overwatch cones check every tile of the walked path, not just the
  // destination (an enemy passing through a cone gets shot).
  setPendingMovePath(token.id, path);
  let completed;
  try {
    completed = await executePathMove(token, path);
  } finally {
    clearPendingMovePath(token.id);
  }
  if (completed) {
    await spendAP(token, cost);
  }

  token.control({ releaseOthers: true });
  Hooks.callAll("com:refresh");
}

/** Walk recorded BFS links back to the origin, returning cell keys. */
function reconstructPath(destination) {
  const path = [];
  let key = H.cellKey(destination.i, destination.j);
  const seen = new Set();
  while (key && !seen.has(key)) {
    seen.add(key);
    path.unshift(key);
    key = state.reachable.get(key)?.prev ?? null;
  }
  path.shift(); // drop the origin cell
  return path;
}

/** Move the token along the path with Foundry's native movement workflow. */
async function executePathMove(token, pathKeys) {
  const waypoints = pathKeys.map((key) => {
    const [i, j] = key.split(",").map(Number);
    const tl = H.cellTopLeft(i, j);
    return { x: tl.x, y: tl.y, snapped: true };
  });
  if (!waypoints.length) return true;
  return !!(await token.document.move(waypoints, { autoRotate: false, showRuler: false }));
}

/* -------------------------------------------- */
/* Canvas wiring                                */
/* -------------------------------------------- */

/** Listen for clicks on the scene canvas while move mode is active. */
export function registerMovement() {
  Hooks.on("canvasReady", () => {
    const stage = canvas.stage;
    if (!stage) return;
    let down = null;

    stage.on("pointerdown", (ev) => {
      down = { x: ev.global.x, y: ev.global.y };
    });

    stage.on("pointerup", (ev) => {
      if (!down) return;
      const dx = ev.global.x - down.x;
      const dy = ev.global.y - down.y;
      down = null;
      if (dx * dx + dy * dy > 64) return; // dragged, not a click
      if (!state.active) return;
      const world = canvas.stage.toLocal(ev.global);
      requestMoveTo(world.x, world.y);
    });
  });

  // Leaving a token (re-selecting, deleting) ends move mode.
  Hooks.on("controlToken", (token, controlled) => {
    if (state.active && (!controlled || token.id !== state.token?.id)) {
      cancelMoveMode();
    }
  });
}

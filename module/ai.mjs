/**
 * Enemy AI: runs hostile units' turns automatically on the GM client.
 *
 * Decision priority each time the unit still has AP:
 *  1. FLEE   — badly wounded (<= 30% HP) and not able to finish a target.
 *  2. ATTACK — a living, spotted enemy is inside weapon range with LOS
 *              (highest hit chance first, lowest HP breaks ties).
 *  3. ADVANCE— a target is spotted but out of range: move to the reachable
 *              tile that closes the most distance (green range preferred).
 *  4. HOLD   — nothing spotted: go on overwatch, then end the turn.
 *
 * Disable per unit by unchecking "AI Controlled" on the sheet (the
 * `com.aiControlled` actor flag; legacy worlds with `com.noAI` are
 * honored), globally with the "com.aiEnabled" world setting, or run a
 * turn manually via `game.com.ai.takeTurn(token)`.
 */
import { SQ } from "./config.mjs";
import * as H from "./helpers.mjs";
import { attackAction, overwatchAction, spendAP, setPendingMovePath, clearPendingMovePath } from "./actions.mjs";
import { computeReachable } from "./movement.mjs";
import { dirToward } from "./cone.mjs";
import { coverLevelAgainst, coverBonus } from "./cover.mjs";

const AI = {
  // At or below this fraction of max HP the unit tries to disengage.
  FLEE_HP_PCT: 0.3,
  // Pause between AI actions so humans can follow along.
  ACTION_DELAY_MS: 700,
  // Hard cap on actions per turn (safety net against decision loops).
  MAX_ACTIONS: 4,
  // Delay after a turn starts before the AI acts.
  TURN_START_DELAY_MS: 800
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* -------------------------------------------- */
/* Registration                                 */
/* -------------------------------------------- */

export function registerAI() {
  game.settings.register(SQ.id, "aiEnabled", {
    name: game.i18n.localize("COM.AI.SettingName"),
    hint: game.i18n.localize("COM.AI.SettingHint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  Hooks.on("updateCombat", (combat, change) => {
    if (!("turn" in change || "round" in change)) return;
    if (!game.user.isGM) return;

    const token = combat.combatant?.token?.object;
    if (!token?.actor) return;
    if (H.sideOf(token) === H.SIDE.NEUTRAL) {
      // Neutrals don't fight — if the AI owns the token, pass the turn along
      // so the encounter keeps flowing; otherwise leave it for manual play.
      if (aiControls(token)) {
        setTimeout(() => {
          if (H.activeToken()?.id !== token.id) return;
          Promise.resolve(game.com?.endTurn?.()).catch((err) => console.error("COM AI error:", err));
        }, AI.TURN_START_DELAY_MS);
      }
      return;
    }
    if (!aiControls(token)) return;
    if (token.actor.system.hp.value <= 0) return;

    setTimeout(() => {
      // Re-validate: the turn may have moved on during the delay.
      if (H.activeToken()?.id !== token.id) return;
      takeTurn(token).catch((err) => console.error("COM AI error:", err));
    }, AI.TURN_START_DELAY_MS);
  });
}

/** Delegates to the shared per-unit AI flag check. */
function aiControls(token) {
  return H.isAIControlled(token);
}

/* -------------------------------------------- */
/* Turn loop                                    */
/* -------------------------------------------- */

/** Run one full AI turn for an enemy token. */
export async function takeTurn(token) {
  if (!H.activeCombat()) return;

  for (let step = 0; step < AI.MAX_ACTIONS; step++) {
    if (H.activeToken()?.id !== token.id) return; // turn moved on
    const actor = token.actor;
    if (!actor || actor.system.hp.value <= 0) return;
    if (actor.system.ap.value <= 0) return; // auto-end will advance

    const decision = decide(token);
    if (!decision) {
      await game.com.endTurn();
      return;
    }
    await execute(token, decision);
    await wait(AI.ACTION_DELAY_MS);
  }
}

/* -------------------------------------------- */
/* Decision making                              */
/* -------------------------------------------- */

/** Living, spotted (visible + not hidden) tokens on the unit's enemy side. */
function spottedEnemies(token) {
  const enemySide = H.enemySideOf(token);
  return canvas.tokens.placeables.filter((t) => {
    if (t.id === token.id) return false;
    if (t.document.hidden) return false;
    if (H.sideOf(t) !== enemySide) return false;
    if (!t.actor || t.actor.system.hp.value <= 0) return false;
    return H.hasLOS(H.tokenCenter(token), H.tokenCenter(t));
  });
}

function hitChance(token, target) {
  // Cover-aware so the AI prefers exposed targets, matching real attacks
  // (melee ignores cover, same rule as attackAction).
  const melee = Number(H.getEquippedWeapon(token.actor).system.range) <= 1;
  const cover = melee ? 0 : coverBonus(coverLevelAgainst(token, target));
  return Math.clamp(
    token.actor.system.aim - target.actor.system.defense - cover,
    SQ.MIN_HIT,
    SQ.MAX_HIT
  );
}

/**
 * Choose the next action for the unit, or null to end the turn.
 * Returns {type: "attack"|"move"|"overwatch", ...}.
 */
function decide(token) {
  const sys = token.actor.system;
  const weapon = H.getEquippedWeapon(token.actor);
  const spotted = spottedEnemies(token);
  const inRange = spotted.filter((t) => H.gridDistance(token, t) <= weapon.system.range);

  // 1) Flee when badly hurt and no target is one shot from dropping.
  const wounded = sys.hp.value <= Math.max(1, Math.floor(sys.hp.max * AI.FLEE_HP_PCT));
  const killShot = inRange.find((t) => t.actor.system.hp.value <= 4);
  if (wounded && !killShot) {
    const cell = pickFleeCell(token, spotted);
    if (cell) return { type: "move", cell, flee: true };
    return sys.overwatch ? null : { type: "overwatch", dir: overwatchDir(token) };
  }

  // 2) Attack the best target in range: hit chance first, then lowest HP.
  if (inRange.length) {
    const best = inRange.reduce((a, b) => {
      const ca = hitChance(token, a) * 100 - a.actor.system.hp.value;
      const cb = hitChance(token, b) * 100 - b.actor.system.hp.value;
      return cb > ca ? b : a;
    });
    return { type: "attack", target: best };
  }

  // 3) Advance toward the nearest spotted target.
  if (spotted.length) {
    const nearest = spotted.reduce((a, b) =>
      H.gridDistance(token, b) < H.gridDistance(token, a) ? b : a);
    const cell = pickAdvanceCell(token, nearest);
    if (cell) return { type: "move", cell };
  }

  // 4) Hold: overwatch if not already, otherwise done for the turn.
  if (!sys.overwatch && sys.ap.value >= SQ.OVERWATCH_AP) {
    return { type: "overwatch", dir: overwatchDir(token) };
  }
  return null;
}

/**
 * Cone facing for an AI overwatch: point at the nearest visible living
 * token on the unit's enemy side, or null for full 360° coverage when none
 * is visible.
 */
function overwatchDir(token) {
  const enemySide = H.enemySideOf(token);
  const enemies = canvas.tokens.placeables.filter((t) =>
    t.id !== token.id
      && !t.document.hidden
      && H.sideOf(t) === enemySide
      && t.actor?.system.hp.value > 0
  );
  if (!enemies.length) return null;
  const nearest = enemies.reduce((a, b) =>
    H.gridDistance(token, b) < H.gridDistance(token, a) ? b : a);
  const c = H.tokenCenter(nearest);
  return dirToward(token, c.x, c.y);
}

/**
 * Reachable cell that gets the unit closest to the target.
 * Prefers the 1-AP (green) band so the second AP stays available.
 */
function pickAdvanceCell(token, target) {
  const reachable = computeReachable(token);
  if (!reachable.size) return null;
  const here = H.gridDistance(token, target);

  let best = null;
  let bestScore = here * 10; // must strictly beat staying put
  for (const entry of reachable.values()) {
    const center = H.cellCenter(entry.i, entry.j);
    const dist = Math.ceil(
      Math.hypot(H.tokenCenter(target).x - center.x, H.tokenCenter(target).y - center.y)
      / canvas.grid.size
    );
    // Lower score is better; small bias toward cheap moves.
    const score = dist * 10 + (entry.cost > 1 ? 1 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = entry;
    }
  }
  return best;
}

/** Reachable cell maximizing distance from the nearest threat. */
function pickFleeCell(token, threats) {
  if (!threats.length) return null;
  const reachable = computeReachable(token);
  if (!reachable.size) return null;

  const here = Math.min(...threats.map((t) => H.gridDistance(token, t)));
  let best = null;
  let bestDist = here + 1; // must strictly improve

  for (const entry of reachable.values()) {
    const center = H.cellCenter(entry.i, entry.j);
    const dist = Math.min(...threats.map((t) =>
      Math.ceil(Math.hypot(H.tokenCenter(t).x - center.x, H.tokenCenter(t).y - center.y)
        / canvas.grid.size)));
    if (dist > bestDist) {
      bestDist = dist;
      best = entry;
    }
  }
  return best;
}

/* -------------------------------------------- */
/* Execution                                    */
/* -------------------------------------------- */

async function execute(token, decision) {
  switch (decision.type) {
    case "attack":
      await attackAction(token, decision.target);
      break;
    case "overwatch":
      await overwatchAction(token, { dir: decision.dir });
      break;
    case "move":
      await aiMove(token, decision.cell, decision.flee);
      if (decision.flee) {
        await postFlavor(token, "COM.AI.FleeMsg");
      }
      break;
  }
}

/** Move the AI token along a reachable entry's path, spending its AP cost. */
async function aiMove(token, entry, flee) {
  // Rebuild the BFS path by walking the prev links.
  const waypoints = [];
  let key = H.cellKey(entry.i, entry.j);
  const reachable = computeReachable(token);
  const guard = new Set();
  while (key && !guard.has(key)) {
    guard.add(key);
    waypoints.unshift(key);
    key = reachable.get(key)?.prev ?? null;
  }
  waypoints.shift(); // drop the origin cell
  if (!waypoints.length) return;

  const cost = entry.cost;
  const moves = waypoints.map((k) => {
    const [i, j] = k.split(",").map(Number);
    const tl = H.cellTopLeft(i, j);
    return { x: tl.x, y: tl.y, snapped: true };
  });
  // Report the walked path so overwatch cones trigger on tiles passed
  // through, not just the destination.
  setPendingMovePath(token.id, waypoints);
  let completed;
  try {
    completed = !!(await token.document.move(moves, { autoRotate: false, showRuler: false }));
  } finally {
    clearPendingMovePath(token.id);
  }
  if (completed) await spendAP(token, cost);
  void flee;
}

/** Small flavor chat line so players can follow enemy decisions. */
async function postFlavor(token, key) {
  await ChatMessage.create({
    user: game.userId,
    speaker: ChatMessage.getSpeaker({ token: token.document }),
    content: `<i>${token.name} ${game.i18n.localize(key)}</i>`
  });
}

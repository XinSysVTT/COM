/**
 * Tactical actions: attacks (including overwatch reactions), setting
 * overwatch with a cone facing, AP spending and the automatic end-of-turn
 * when AP runs out.
 */
import { SQ } from "./config.mjs";
import * as H from "./helpers.mjs";
import { coneFor, pointCovered } from "./cone.mjs";
import { coverLevelAgainst, coverBonus, coverLabel } from "./cover.mjs";
import { shoot } from "./fx.mjs";

/* -------------------------------------------- */
/* Attack                                       */
/* -------------------------------------------- */

/**
 * Resolve an attack from one token against another.
 * Hit chance = aim - defense - cover bonus (minus the overwatch penalty
 * for reactions), clamped to [MIN_HIT, MAX_HIT]. Damage is rolled from the
 * weapon. Melee attacks (range 1) ignore cover.
 *
 * @param {Token} attacker
 * @param {Token} target
 * @param {object} [options]
 * @param {boolean} [options.reaction]  True for overwatch reaction shots
 *   (turn/AP validation is skipped; the penalty is applied).
 */
export async function attackAction(attacker, target, { reaction = false } = {}) {
  if (!attacker?.actor || !target?.actor) return;
  if (attacker.id === target.id) return;

  const aActor = attacker.actor;
  const tActor = target.actor;
  const aSys = aActor.system;
  const tSys = tActor.system;
  const weapon = H.getEquippedWeapon(aActor);
  const melee = Number(weapon.system.range) <= 1;

  if (!reaction) {
    const gate = H.canAct(attacker, SQ.ATTACK_AP);
    if (!gate.ok) {
      H.notify(gate.reason);
      return;
    }
    const dist = H.gridDistance(attacker, target);
    if (dist > weapon.system.range) {
      H.notify("COM.Notif.OutOfRange");
      return;
    }
  }

  if (!H.hasLOS(H.tokenCenter(attacker), H.tokenCenter(target))) {
    H.notify("COM.Notif.NoLOS");
    return;
  }
  if (tSys.hp.value <= 0) {
    H.notify("COM.Notif.TargetDown");
    return;
  }

  const coverLevel = coverLevelAgainst(attacker, target);
  const coverPenalty = melee ? 0 : coverBonus(coverLevel);
  const chance = Math.clamp(
    aSys.aim - tSys.defense - coverPenalty - (reaction ? SQ.OVERWATCH_PENALTY : 0),
    SQ.MIN_HIT,
    SQ.MAX_HIT
  );
  const hitRoll = await new Roll("1d100").evaluate();
  const hit = hitRoll.total <= chance;

  // The shot plays out (tracer/slash, impact) before damage lands.
  await shoot({
    attacker,
    target,
    hit,
    melee
  });

  let dmgRoll = null;
  let newHp = tSys.hp.value;
  if (hit) {
    dmgRoll = await new Roll(weapon.system.damage || "1").evaluate();
    newHp = Math.max(0, tSys.hp.value - dmgRoll.total);
    await tActor.update({ "system.hp.value": newHp });
  }

  if (newHp <= 0) {
    await H.setOverlay(tActor, SQ.DOWNED_EFFECT, SQ.DOWNED_ICON, true);
    await H.setOverwatch(tActor, false);
    await H.markDefeated(target, true);
  }

  await renderAttackCard({
    attacker,
    reaction,
    attackerName: attacker.name,
    targetName: target.name,
    weaponName: weapon.name,
    chance,
    coverLabel: coverLevel > 0 ? `${coverLabel(coverLevel)} (−${coverPenalty}%)` : null,
    hitRollTotal: hitRoll.total,
    hit,
    damage: dmgRoll?.total ?? null,
    oldHp: tSys.hp.value,
    newHp,
    downed: newHp <= 0
  }, { hitRoll, dmgRoll });

  if (!reaction) await spendAP(attacker, SQ.ATTACK_AP);
}

/** Fire overwatch reactions against a token that just finished moving. */
const _owGuard = new Map();

/**
 * Check every watching enemy for a reaction shot on a mover. `pathCells`
 * (optional) lists the grid cells the mover walked through in order — when
 * given, the reaction triggers on the first cone tile entered, so passing
 * *through* a cone counts; without it the mover's current footprint is
 * tested instead (drags, keyboard moves, external API movement).
 */
export async function checkOverwatchTriggers(mover, pathCells = null) {
  const combat = H.activeCombat();
  if (!combat) return;
  if (!mover?.actor || mover.actor.system.hp.value <= 0) return;

  // Avoid duplicate resolution for the same movement burst.
  const now = Date.now();
  if (now - (_owGuard.get(mover.id) ?? 0) < 400) return;
  _owGuard.set(mover.id, now);

  const spots = (pathCells ?? H.tokenCells(mover)).map((key) => {
    const [i, j] = key.split(",").map(Number);
    return H.cellCenter(i, j);
  });

  const moverSide = H.sideOf(mover);
  // Neutrals stay out of the fight: nobody shoots them and they don't shoot.
  if (moverSide === H.SIDE.NEUTRAL) return;
  const watchers = canvas.tokens.placeables.filter(
    (t) => t.id !== mover.id
      && t.actor?.system.overwatch
      && t.actor.system.hp.value > 0
      && H.sideOf(t) !== H.SIDE.NEUTRAL
      && H.sideOf(t) !== moverSide
  );

  for (const watcher of watchers) {
    if (mover.actor.system.hp.value <= 0) break;
    const cone = coneFor(watcher);
    // Cone membership covers weapon range, facing and line of sight.
    if (!cone || !spots.some((p) => pointCovered(watcher, cone, p.x, p.y))) continue;

    await attackAction(watcher, mover, { reaction: true });
    await H.setOverwatch(watcher.actor, false);
  }
}

/* -------------------------------------------- */
/* Movement paths in flight                     */
/* -------------------------------------------- */

/**
 * Cell keys of moves currently being executed, keyed by token id. Set by
 * click-to-move and the AI so the moveToken hook can evaluate the whole
 * walked path against overwatch cones; consumed on first read.
 */
const _pendingPaths = new Map();

export function setPendingMovePath(tokenId, cellKeys) {
  _pendingPaths.set(tokenId, cellKeys);
}

export function clearPendingMovePath(tokenId) {
  _pendingPaths.delete(tokenId);
}

/* -------------------------------------------- */
/* Overwatch                                    */
/* -------------------------------------------- */

/**
 * Put a unit on overwatch: costs 1 AP and lasts until its next turn. The
 * unit covers a cone (SQ.OVERWATCH_CONE_ANGLE wide, weapon range deep)
 * pointing along `dir` — an {x, y} world-space vector. Without a direction
 * (API calls, the sheet checkbox) coverage falls back to a full circle.
 */
export async function overwatchAction(token, { dir = null } = {}) {
  const gate = H.canAct(token, SQ.OVERWATCH_AP);
  if (!gate.ok) {
    H.notify(gate.reason);
    return;
  }
  const actor = token.actor;
  if (actor.system.overwatch) {
    H.notify("COM.Notif.AlreadyOverwatch");
    return;
  }
  await H.setOverwatch(actor, true, dir);
  await spendAP(token, SQ.OVERWATCH_AP);
}

/* -------------------------------------------- */
/* AP & turn flow                               */
/* -------------------------------------------- */

let _autoEndTimer = null;

/**
 * Deduct AP from a token's unit (only while combat is active). If the
 * active unit reaches 0 AP, schedule an automatic end of its turn.
 */
export async function spendAP(token, amount) {
  const actor = token?.actor;
  if (!actor || !H.activeCombat()) return;
  const newValue = Math.max(0, actor.system.ap.value - amount);
  await actor.update({ "system.ap.value": newValue });
  if (newValue <= 0 && H.isActiveCombatant(token)) scheduleAutoEnd();
}

function scheduleAutoEnd() {
  clearTimeout(_autoEndTimer);
  _autoEndTimer = setTimeout(async () => {
    const token = H.activeToken();
    if (!token?.actor) return;
    const sys = token.actor.system;
    if (sys.ap.value > 0 || sys.hp.value <= 0) return;
    try {
      await game.combat.nextTurn();
    } catch {
      H.notify("COM.Notif.NoCombatTurn", "error");
    }
  }, SQ.AUTO_END_DELAY_MS);
}

/* -------------------------------------------- */
/* Hooks                                        */
/* -------------------------------------------- */

/** Clear the downed state (skull overlay + defeated flag) when healed. */
export function registerActionsHooks() {
  Hooks.on("updateActor", async (actor, change) => {
    if (change?.system?.hp?.value === undefined) return;
    if (actor.system.hp.value <= 0) return;
    await H.setOverlay(actor, SQ.DOWNED_EFFECT, SQ.DOWNED_ICON, false);
    for (const token of actor.getActiveTokens()) {
      await H.markDefeated(token, false);
    }
  });

  // Overwatch reactions fire for every completed token movement, whatever
  // produced it (click-to-move, dragging, keyboard, API). The GM client
  // resolves reactions so they are only rolled once.
  Hooks.on("moveToken", (tokenDoc) => {
    if (!game.user.isGM) return;
    const token = tokenDoc?.object;
    if (!token) return;
    const path = _pendingPaths.get(token.id) ?? null;
    _pendingPaths.delete(token.id);
    checkOverwatchTriggers(token, path);
  });
}

/* -------------------------------------------- */
/* Chat card                                    */
/* -------------------------------------------- */

async function renderAttackCard(data, rolls = {}) {
  const content = await renderTemplate("systems/com/templates/chat-card.html", data);
  await ChatMessage.create({
    user: game.userId,
    speaker: ChatMessage.getSpeaker({ token: data.attacker?.document }),
    flavor: game.i18n.localize(data.reaction ? "COM.Card.OverwatchAttack" : "COM.Card.Attack"),
    content,
    rolls: [rolls.hitRoll, rolls.dmgRoll].filter(Boolean),
    flags: { [SQ.id]: { type: "attack" } }
  });
}

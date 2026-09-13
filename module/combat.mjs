/**
 * Side-based combat flow: friendly and neutral tokens act first, then
 * hostile tokens. Each unit's AP is refilled when its turn starts,
 * its overwatch is cleared, and defeated units are skipped automatically.
 */
import * as H from "./helpers.mjs";

export function registerCombat() {
  // Assign side-based initiative as combatants join: players 1, enemies 0.
  // With Foundry's descending sort this groups all players before all enemies.
  Hooks.on("createCombatant", async (combatant) => {
    if (!game.user.isGM) return;
    if (combatant.initiative != null) return;
    const side = H.sideOf(combatant.token);
    await combatant.update({ initiative: side === H.SIDE.ENEMY ? 0 : 1 });
  });

  // Fresh state when a fight begins.
  Hooks.on("combatStart", async (combat) => {
    if (!game.user.isGM) return;
    const actors = new Map();
    for (const c of combat.combatants) {
      if (c.actor) actors.set(c.actor.id, c.actor);
    }
    for (const actor of actors.values()) {
      await actor.update({ "system.ap.value": actor.system.ap.max });
      await H.setOverwatch(actor, false);
    }
  });

  // Turn changes: reset AP / overwatch for the active unit, skip the downed.
  Hooks.on("updateCombat", (combat, change) => {
    if (!game.user.isGM) return;
    if (!("turn" in change) && !("round" in change)) return;
    onTurnStart(combat);
  });

  Hooks.on("deleteCombat", async (combat) => {
    if (!game.user.isGM) return;
    for (const c of combat.combatants) {
      await H.setOverwatch(c.actor, false);
    }
  });
}

/**
 * Handle the start of a unit's turn. If the unit is down, hand the turn to
 * the next combatant instead (this recurses via updateCombat until a live
 * unit is found).
 */
async function onTurnStart(combat) {
  const combatant = combat.combatant;
  if (!combatant) return;

  // A fight is over when one side has no living units: end the combat
  // instead of cycling turns through defeated combatants forever.
  const alive = combat.combatants.filter(
    (c) => (c.actor?.system?.hp?.value ?? 0) > 0
  );
  const players = alive.filter((c) => H.sideOf(c.token) !== H.SIDE.ENEMY);
  const enemies = alive.filter((c) => H.sideOf(c.token) === H.SIDE.ENEMY);
  if (!players.length || !enemies.length) {
    await endCombatWithResult(combat, players.length > 0, enemies.length > 0);
    return;
  }

  const actor = combatant.actor;
  if (actor && actor.system.hp.value <= 0) {
    await combat.nextTurn();
    return;
  }

  if (game.user.isGM) {
    if (actor) {
      await actor.update({ "system.ap.value": actor.system.ap.max });
      await H.setOverwatch(actor, false);
    }
  }

  // Bring the active unit into focus for whoever controls it.
  const token = combatant.token?.object;
  if (token && (game.user.isGM || token.isOwner)) {
    token.control({ releaseOthers: true });
  }
  Hooks.callAll("com:refresh");
}

/**
 * End the encounter and announce which side holds the field.
 * @param {Combat} combat
 * @param {boolean} playersAlive
 * @param {boolean} enemiesAlive
 */
async function endCombatWithResult(combat, playersAlive, enemiesAlive) {
  const key = playersAlive
    ? "COM.Combat.PlayerVictory"
    : enemiesAlive
      ? "COM.Combat.EnemyVictory"
      : "COM.Combat.Draw";
  if (game.user.isGM) {
    // Clear overwatch residue so the next encounter starts clean.
    for (const c of combat.combatants) {
      if (c.actor?.system?.overwatch) {
        await H.setOverwatch(c.actor, false);
      }
    }
    // Deactivate directly — V14's endCombat() opens a modal confirmation
    // and deletes the encounter, which we don't want for an auto-end.
    await combat.update({ active: false });
  }
  await ChatMessage.create({
    user: game.userId,
    speaker: ChatMessage.getSpeaker({ alias: "COM" }),
    content: `<div class="com-card"><div class="com-card-header">${game.i18n.localize(key)}</div></div>`
  });
}

/** Manual end of turn from the HUD. */
export async function endTurn() {
  const combat = game.combat;
  if (!combat?.active) {
    H.notify("COM.Notif.NoCombatTurn");
    return;
  }
  await combat.nextTurn();
}

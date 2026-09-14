/**
 * The tactical HUD: a frameless bar above the hotbar showing the controlled
 * unit's HP/AP and the action buttons (Move, Attack, Overwatch, End Turn).
 */
import { SQ } from "./config.mjs";
import * as H from "./helpers.mjs";
import { moveModeActive, toggleMoveMode } from "./movement.mjs";
import { attackTargetingActive, enterAttackMode } from "./targeting.mjs";
import { overwatchFacingActive, enterOverwatchFacing } from "./overwatch.mjs";
import { attackAction } from "./actions.mjs";
import { endTurn } from "./combat.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class TacticsHud extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "com-hud",
    tag: "aside",
    classes: ["com-hud"],
    positioned: false,
    window: {
      frame: false
    },
    actions: {
      move: TacticsHud.#onMove,
      attack: TacticsHud.#onAttack,
      overwatch: TacticsHud.#onOverwatch,
      endTurn: TacticsHud.#onEndTurn
    }
  };

  static PARTS = {
    root: {
      template: `systems/${SQ.id}/templates/hud.html`
    }
  };

  get unitToken() {
    return canvas.tokens.controlled[0] ?? null;
  }

  /** @override */
  _prepareContext(options) {
    const token = this.unitToken;
    if (!token?.actor) {
      return { unit: null };
    }
    const sys = token.actor.system;
    const inCombat = H.activeCombat() !== null;
    const pips = [];
    for (let i = 0; i < sys.ap.max; i++) {
      pips.push({ filled: i < sys.ap.value });
    }
    const target = game.user.targets.first();
    return {
      unit: {
        name: token.name,
        img: token.actor.img ?? CONST.DEFAULT_TOKEN,
        hp: sys.hp.value,
        hpMax: sys.hp.max,
        hpPct: Math.max(0, Math.min(100, Math.round((100 * sys.hp.value) / Math.max(1, sys.hp.max)))),
        ap: sys.ap.value,
        apMax: sys.ap.max,
        overwatch: sys.overwatch
      },
      pips,
      // In combat the radial command ring around the active unit is the
      // only action surface; the card below keeps action buttons for
      // freeform (out-of-combat) play only.
      showActions: !inCombat,
      // AI-controlled units are spectated: show an "AI acting" note instead
      // of anything actionable.
      aiActing: inCombat && H.isActiveCombatant(token) && H.isAIControlled(token),
      canMove: H.canAct(token, SQ.MOVE_AP).ok,
      canAttack: H.canAct(token, SQ.ATTACK_AP).ok,
      canOverwatch: H.canAct(token, SQ.OVERWATCH_AP).ok && !sys.overwatch,
      inCombat: inCombat && H.isActiveCombatant(token),
      moveMode: moveModeActive(),
      targeting: attackTargetingActive(),
      overwatchMode: overwatchFacingActive(),
      target: target ? target.name : null
    };
  }

  /* -------------------------------------------- */
  /* Actions                                      */
  /* -------------------------------------------- */

  static #onMove() {
    const token = this.unitToken;
    if (token) toggleMoveMode(token);
  }

  static #onAttack() {
    const token = this.unitToken;
    if (!token) return;
    const target = game.user.targets.first();
    if (!target) {
      enterAttackMode(token); // crosshair mode: click an enemy to fire
      return;
    }
    attackAction(token, target).then(() => H.clearTargets());
  }

  static #onOverwatch() {
    const token = this.unitToken;
    if (token) enterOverwatchFacing(token);
  }

  static #onEndTurn() {
    endTurn();
  }
}

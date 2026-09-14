/**
 * COM — a lightweight XCOM-style tactical system for Foundry VTT.
 *
 * Basics: side-based turns (players act, then enemies), AP-driven actions
 * (move / attack / overwatch), click-to-move with a highlighted movement
 * range, and overwatch reaction shots.
 */
import { SQ } from "./config.mjs";
import { UnitData, WeaponData } from "./models.mjs";
import { invalidateWallCache } from "./helpers.mjs";
import { registerTargeting } from "./targeting.mjs";
import { registerCombat, endTurn } from "./combat.mjs";
import { registerMovement, cancelMoveMode, moveModeActive } from "./movement.mjs";
import { registerActionsHooks, attackAction, overwatchAction } from "./actions.mjs";
import { registerOverwatchFacing, enterOverwatchFacing } from "./overwatch.mjs";
import { refreshOverwatchCones, invalidateConeCache } from "./cone.mjs";
import { registerAI, takeTurn } from "./ai.mjs";
import { registerArsenal } from "./arsenal.mjs";
import { registerTestFight } from "./test-fight.mjs";
import { registerUIToggle, toggleCoreUI } from "./ui-toggle.mjs";
import { registerTokenOverlay } from "./token-overlay.mjs";
import { registerTokenActions, refreshTokenActions } from "./token-actions.mjs";
import { registerCover } from "./cover.mjs";
import { registerProps } from "./props.mjs";
import { computeReachable } from "./movement.mjs";
import { TacticsHud } from "./hud.mjs";
import { TurnOrderHud, registerTurnOrderSettings } from "./turn-order.mjs";
import { UnitSheet } from "./sheets/unit-sheet.mjs";
import { WeaponSheet } from "./sheets/weapon-sheet.mjs";
import { comIcon } from "./icons.mjs";

Hooks.once("init", () => {
  // Document type labels (used in sheet titles etc.)
  CONFIG.Actor.typeLabels.unit = "Unit";
  CONFIG.Item.typeLabels.weapon = "Weapon";

  // Data models behind the types declared in system.json documentTypes
  // (replaces the removed template.json and its default values).
  CONFIG.Actor.dataModels.unit = UnitData;
  CONFIG.Item.dataModels.weapon = WeaponData;

  // Uniform action icons, shared by the command ring and the HUD card.
  Handlebars.registerHelper("comIcon", (name) => new Handlebars.SafeString(comIcon(name)));

  // Sheets
  DocumentSheetConfig.registerSheet(Actor, SQ.id, UnitSheet, {
    makeDefault: true,
    label: "COM.Sheet.Unit",
    types: ["unit"]
  });
  DocumentSheetConfig.registerSheet(Item, SQ.id, WeaponSheet, {
    makeDefault: true,
    label: "COM.Sheet.Weapon",
    types: ["weapon"]
  });

  registerCombat();
  registerMovement();
  registerActionsHooks();
  registerOverwatchFacing();
  registerAI();
  registerArsenal();
  registerTestFight();
  registerUIToggle();
  registerTurnOrderSettings();
  registerTokenOverlay();
  registerTokenActions();
  registerTargeting();
  registerCover();
  registerProps();

  // Wall geometry changed: forget cached segments used by pathfinding and
  // the line-of-sight data behind overwatch cones.
  for (const hook of ["createWall", "updateWall", "deleteWall"]) {
    Hooks.on(hook, () => {
      invalidateWallCache();
      invalidateConeCache();
    });
  }

  // ESC leaves move mode.
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && moveModeActive()) cancelMoveMode();
  });
});

Hooks.once("ready", () => {
  const hud = new TacticsHud();
  const turnOrder = new TurnOrderHud();
  for (const app of [hud, turnOrder]) {
    // ApplicationV2's first render is a no-op without force.
    app.render({ force: true }).catch((err) => {
      console.error("COM: HUD failed to render", err);
      window.__comHudError = String(err?.stack ?? err);
    });
  }
  // Safety net: if the first render was lost, try again shortly after startup.
  setTimeout(() => {
    for (const app of [hud, turnOrder]) {
      if (!app.rendered) {
        app.render({ force: true }).catch((err) => {
          console.error("COM: HUD retry failed", err);
          window.__comHudError = String(err?.stack ?? err);
        });
      }
    }
  }, 2500);

  // Public API (also handy for debugging and macros).
  game.com = {
    version: "0.1.7",
    hud,
    turnOrder,
    attack: attackAction,
    overwatch: overwatchAction,
    overwatchFacing: enterOverwatchFacing,
    endTurn,
    cancelMoveMode,
    ai: { takeTurn },
    reachable: computeReachable
  };

  // Refresh the HUDs whenever anything relevant changes. Never re-render
  // the turn order mid-drag, that would drop the pointer capture.
  const refresh = debounce(() => {
    hud.render({ force: true });
    if (!turnOrder._dragging) turnOrder.render({ force: true });
    refreshTokenActions();
    refreshOverwatchCones();
  }, 100);
  for (const hook of [
    "controlToken", "targetToken", "updateActor", "updateToken",
    "updateCombat", "createCombat", "deleteCombat", "combatStart",
    "createCombatant", "updateCombatant", "deleteCombatant",
    "canvasReady", "com:refresh"
  ]) {
    Hooks.on(hook, refresh);
  }
});

// Small throttle helper (avoids foundry.utils.debounce dependency surprises).
function debounce(fn, ms) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

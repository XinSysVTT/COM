/**
 * Overwatch facing mode: pressing Overwatch without a direction enters a
 * cone-aiming mode — a live cone preview sweeps with the mouse and clicking
 * locks the facing in. ESC or selecting something else cancels.
 */
import { SQ } from "./config.mjs";
import * as H from "./helpers.mjs";
import { coneFor, coneCells, dirToward, dirFromRotation } from "./cone.mjs";
import { overwatchAction } from "./actions.mjs";
import { cancelMoveMode } from "./movement.mjs";
import { cancelAttackMode } from "./targeting.mjs";

const state = { active: false, token: null };
let _lastPreviewCell = null;

export function overwatchFacingActive() {
  return state.active;
}

/** Enter cone-facing mode for a unit (if it can still go on overwatch). */
export function enterOverwatchFacing(token) {
  const gate = H.canAct(token, SQ.OVERWATCH_AP);
  if (!gate.ok) {
    H.notify(gate.reason);
    return;
  }
  if (token.actor.system.overwatch) {
    H.notify("COM.Notif.AlreadyOverwatch");
    return;
  }
  cancelMoveMode();
  cancelAttackMode();
  state.token = token;
  state.active = true;
  _lastPreviewCell = null;
  document.body.classList.add("com-overwatch-facing");
  drawPreview(dirFromRotation(token));
  Hooks.callAll("com:refresh");
}

export function cancelOverwatchFacing() {
  if (!state.active) return;
  state.active = false;
  state.token = null;
  document.body.classList.remove("com-overwatch-facing");
  H.clearHighlightLayer(SQ.CONE_PREVIEW_NAME);
  Hooks.callAll("com:refresh");
}

/** Sweep the preview cone toward the mouse (redrawn once per cell crossed). */
function drawPreview(dir) {
  const token = state.token;
  H.clearHighlightLayer(SQ.CONE_PREVIEW_NAME);
  if (!token || !H.ensureHighlightLayer(SQ.CONE_PREVIEW_NAME)) return;
  const cone = coneFor(token, { dir });
  if (!cone) return;
  for (const cell of coneCells(token, cone)) {
    H.highlightCell(SQ.CONE_PREVIEW_NAME, cell.i, cell.j, SQ.COLOR_OVERWATCH);
  }
}

/** Lock the facing toward a world point and put the unit on overwatch. */
function confirmFacing(worldX, worldY) {
  const token = state.token;
  cancelOverwatchFacing();
  if (!token) return;
  overwatchAction(token, { dir: dirToward(token, worldX, worldY) });
}

export function registerOverwatchFacing() {
  // DOM-level wiring: clicks and movement over tokens are stopped by
  // Foundry's token interaction before reaching the stage.
  Hooks.on("canvasReady", () => {
    const view = H.canvasViewElement();
    if (!view || view.dataset.comOverwatchWired) return;
    view.dataset.comOverwatchWired = "1";
    let down = null;

    view.addEventListener("pointerdown", (ev) => {
      if (ev.button !== 0) return;
      down = { x: ev.clientX, y: ev.clientY };
    }, true);
    view.addEventListener("pointerup", (ev) => {
      if (ev.button !== 0 || !down) return;
      const dx = ev.clientX - down.x;
      const dy = ev.clientY - down.y;
      down = null;
      if (dx * dx + dy * dy > 64) return;
      if (!state.active) return;
      const w = H.worldFromClient(ev.clientX, ev.clientY);
      confirmFacing(w.x, w.y);
    }, true);
    view.addEventListener("pointermove", (ev) => {
      if (!state.active || !state.token) return;
      const w = H.worldFromClient(ev.clientX, ev.clientY);
      const cell = H.cellAt(w.x, w.y);
      const key = H.cellKey(cell.i, cell.j);
      if (key === _lastPreviewCell) return;
      _lastPreviewCell = key;
      drawPreview(dirToward(state.token, w.x, w.y));
    }, true);
  });

  // Losing the token (re-select, delete) leaves facing mode.
  Hooks.on("controlToken", (token, controlled) => {
    if (state.active && (!controlled || token.id !== state.token?.id)) {
      cancelOverwatchFacing();
    }
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.active) cancelOverwatchFacing();
  });
}

/**
 * Radial token actions — an Imperial-Assault-style command ring rendered
 * around the active unit's token on the canvas:
 *
 * - four identical arc plates hugging the token: Move (upper left),
 *   Attack (lower left), Overwatch (upper right) and End Turn (lower
 *   right), mirrored so each side's pair leaves the same small gap at the
 *   horizontal;
 * - a COST pill below the token that shows the hovered action's AP cost,
 *   or the unit's remaining AP when idle.
 *
 * Hotkeys: 1 = Move, 2 = Attack, 3 = Overwatch, F = End Turn.
 *
 * The ring belongs to a DOM overlay projected from canvas coordinates, so
 * it stays glued to the token while panning/zooming — it is never nudged
 * to dodge other UI; it simply draws over the screen-fixed bars. The plate
 * shapes are SVG annular sectors generated from the live ring radius, so
 * they hug the token at any zoom level and any token size. Hit areas are
 * the painted plate only — dead corners of the button boxes pass
 * clicks through to the canvas. Buttons appear for the active combatant
 * when the current user controls it, and share all gating logic with the
 * tactical HUD.
 */
import { SQ } from "./config.mjs";
import * as H from "./helpers.mjs";
import { comIcon } from "./icons.mjs";
import { toggleMoveMode, moveModeActive } from "./movement.mjs";
import { enterAttackMode, attackTargetingActive } from "./targeting.mjs";
import { enterOverwatchFacing, overwatchFacingActive } from "./overwatch.mjs";
import { attackAction } from "./actions.mjs";
import { endTurn } from "./combat.mjs";

// Ring geometry (screen px). Radius = token half-size * zoom + GAP.
const GAP = 40;
const PLATE_OUT = 40;      // plate thickness beyond the ring radius
const PLATE_SPAN = (66 / 180) * Math.PI; // angular width of each plate
const PLATE_ICON_OFFSET = 19; // icon distance outward from the ring radius
const KEY_OFFSET = 50;        // key chip distance outward from the ring radius
const PILL_OFFSET = 34;       // COST pill center below the ring radius

const ACTIONS = [
  { id: "move", key: "1", icon: "move", label: "COM.Hud.Move", kind: "plate", angle: -142, cost: SQ.MOVE_AP },
  { id: "attack", key: "2", icon: "attack", label: "COM.Hud.Attack", kind: "plate", angle: 142, cost: SQ.ATTACK_AP },
  { id: "overwatch", key: "3", icon: "overwatch", label: "COM.Hud.Overwatch", kind: "plate", angle: -38, cost: SQ.OVERWATCH_AP },
  { id: "endTurn", key: "F", icon: "endTurn", label: "COM.Hud.EndTurn", kind: "plate", angle: 38, cost: 0 }
];

let _container = null;
let _token = null;
let _lastPlateKey = null;

/* -------------------------------------------- */
/* Registration                                 */
/* -------------------------------------------- */

export function registerTokenActions() {
  game.keybindings.register(SQ.id, "moveAction", {
    name: "COM.Keys.Move", hint: "COM.Keys.Hint",
    editable: [{ key: "Digit1" }],
    onDown: () => performAction("move")
  });
  game.keybindings.register(SQ.id, "attackAction", {
    name: "COM.Keys.Attack", hint: "COM.Keys.Hint",
    editable: [{ key: "Digit2" }],
    onDown: () => performAction("attack")
  });
  game.keybindings.register(SQ.id, "overwatchAction", {
    name: "COM.Keys.Overwatch", hint: "COM.Keys.Hint",
    editable: [{ key: "Digit3" }],
    onDown: () => performAction("overwatch")
  });
  game.keybindings.register(SQ.id, "endTurnAction", {
    name: "COM.Keys.EndTurn", hint: "COM.Keys.Hint",
    editable: [{ key: "KeyF" }],
    onDown: () => performAction("endTurn")
  });

  Hooks.once("ready", () => {
    _container = document.createElement("nav");
    _container.id = "com-token-actions";
    _container.addEventListener("click", (ev) => {
      const btn = ev.target.closest("button[data-com-action]");
      if (!btn || btn.disabled) return;
      performAction(btn.dataset.comAction);
    });
    // Hovering a control echoes its AP cost in the pill below the token.
    _container.addEventListener("pointerover", (ev) => {
      const btn = ev.target.closest("button[data-com-action]");
      if (!btn || btn.disabled) return;
      setPill(btn.dataset.comAction);
    });
    _container.addEventListener("pointerout", (ev) => {
      const btn = ev.target.closest("button[data-com-action]");
      if (!btn || btn.contains(ev.relatedTarget)) return;
      resetPill();
    });
    document.body.appendChild(_container);
    refreshTokenActions();
    followLoop();
  });

  // Track the camera so the ring follows the token while panning/zooming.
  Hooks.on("canvasPan", () => repositionOnly());
}

/* -------------------------------------------- */
/* Rendering                                    */
/* -------------------------------------------- */

/** The token the ring belongs to, if any. AI-controlled units are spectated,
 * never commanded: their turns render no ring. */
function radialToken() {
  if (!H.activeCombat()) return null;
  const token = H.activeToken();
  if (!token?.actor) return null;
  if (!(game.user.isGM || token.isOwner)) return null;
  if (H.isAIControlled(token)) return null;
  return token;
}

/** Full refresh: rebuild the ring and reposition. */
export function refreshTokenActions() {
  if (!_container) return;
  const token = radialToken();
  _token = token;

  if (!token) {
    _container.innerHTML = "";
    _container.classList.remove("com-visible");
    return;
  }

  const sys = token.actor.system;
  const enabled = {
    move: H.canAct(token, SQ.MOVE_AP).ok,
    attack: H.canAct(token, SQ.ATTACK_AP).ok,
    overwatch: H.canAct(token, SQ.OVERWATCH_AP).ok && !sys.overwatch,
    endTurn: H.activeCombat() !== null && H.isActiveCombatant(token)
  };

  const frag = document.createDocumentFragment();
  for (const action of ACTIONS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `com-ra com-ra-${action.kind}`;
    btn.dataset.comAction = action.id;
    btn.dataset.comAngle = action.angle;
    btn.disabled = !enabled[action.id];
    btn.title = `${game.i18n.localize(action.label)} [${action.key}]`;
    btn.innerHTML = comIcon(action.icon, "com-ra-icon") +
      (action.kind === "plate" ? `<svg class="com-ra-shape" aria-hidden="true"><path/></svg>` : "") +
      `<span class="com-ra-key">${action.key}</span>`;
    frag.appendChild(btn);
  }
  const pill = document.createElement("div");
  pill.className = "com-ra-pill";
  pill.innerHTML = `<span class="com-ra-pill-label"></span><i class="com-ra-pill-sep"></i><span class="com-ra-pill-value"></span>`;
  frag.appendChild(pill);

  _container.innerHTML = "";
  _container.appendChild(frag);

  // Reflect engaged modes: the matching control glows while aiming/aiming a cone.
  for (const [id, active] of [
    ["move", moveModeActive()],
    ["attack", attackTargetingActive()],
    ["overwatch", overwatchFacingActive()]
  ]) {
    if (active) _container.querySelector(`[data-com-action="${id}"]`)?.classList.add("com-ra-mode");
  }

  resetPill();
  const wasVisible = _container.classList.contains("com-visible");
  _container.classList.add("com-visible");
  // Ripple the controls in only when the ring (re-)appears, not on every
  // state refresh while it is already on screen.
  if (!wasVisible) {
    _container.classList.add("com-animate");
    setTimeout(() => _container.classList.remove("com-animate"), 600);
  }
  _lastFollowKey = null;
  _lastPlateKey = null;
  positionContainer(token);
}

/** Pill content for a hovered action id, or the idle AP readout when null. */
function setPill(actionId) {
  const label = _container?.querySelector(".com-ra-pill-label");
  const value = _container?.querySelector(".com-ra-pill-value");
  if (!label || !value) return;
  if (!actionId) return resetPill();
  if (actionId === "endTurn") {
    label.textContent = game.i18n.localize("COM.Hud.EndShort");
    value.textContent = game.i18n.localize("COM.Hud.TurnShort");
  } else {
    const cost = ACTIONS.find((a) => a.id === actionId)?.cost ?? 0;
    label.textContent = game.i18n.localize("COM.Hud.Cost");
    value.textContent = `${game.i18n.localize("COM.Hud.ApShort")} ${cost}`;
  }
}

/** Idle pill: the unit's remaining AP. */
function resetPill() {
  const label = _container?.querySelector(".com-ra-pill-label");
  const value = _container?.querySelector(".com-ra-pill-value");
  if (!label || !value || !_token?.actor) return;
  label.textContent = game.i18n.localize("COM.Hud.ApShort");
  value.textContent = String(_token.actor.system.ap.value);
}

/** Cheap reposition without rebuilding (camera moves). */
function repositionOnly() {
  if (!_container?.classList.contains("com-visible")) return;
  const token = radialToken();
  if (token) positionContainer(token);
}

/**
 * The ring's world position: the token's *visual* center, so the ring
 * glides along while the token is animated (click-to-move) or dragged,
 * not just after the document position settles.
 */
function visualCenter(token) {
  return { x: token.position.x + token.w / 2, y: token.position.y + token.h / 2 };
}

function positionContainer(token) {
  const zoom = canvas.stage?.scale?.x ?? canvas.scene?._viewPosition?.scale ?? 1;
  const client = canvas.clientCoordinatesFromCanvas(visualCenter(token));

  const radius = (Math.max(token.w, token.h) / 2) * zoom + GAP;

  // The ring is never nudged away from the token: dodging under the
  // screen-fixed turn-order strip / status card made the controls detach
  // and snap back while panning. It draws above them instead (z-index).
  _container.style.left = `${client.x}px`;
  _container.style.top = `${client.y}px`;

  // Each control's box is centered on its spot on the ring, the pill hangs
  // below the token. Key chips float radially outside every control at the
  // same distance from the ring.
  for (const btn of _container.querySelectorAll("button[data-com-action]")) {
    const a = (Number(btn.dataset.comAngle) * Math.PI) / 180;
    btn.style.left = `${Math.cos(a) * radius}px`;
    btn.style.top = `${Math.sin(a) * radius}px`;
    btn.style.setProperty("--com-ra-kx", `${(Math.cos(a) * KEY_OFFSET).toFixed(1)}px`);
    btn.style.setProperty("--com-ra-ky", `${(Math.sin(a) * KEY_OFFSET).toFixed(1)}px`);
  }
  const pill = _container.querySelector(".com-ra-pill");
  if (pill) pill.style.top = `${radius + PILL_OFFSET}px`;

  layoutPlates(radius);
}

/**
 * Regenerate the plate SVG geometry for the current ring radius. The arc
 * center is the token's center expressed in each button's local box, so
 * plates hug the token and flatten naturally as the ring grows.
 */
function layoutPlates(radius) {
  const key = radius.toFixed(1);
  if (_lastPlateKey === key) return;
  _lastPlateKey = key;

  for (const btn of _container.querySelectorAll(".com-ra-plate")) {
    const svg = btn.querySelector(".com-ra-shape");
    const path = svg?.querySelector("path");
    const angle = (Number(btn.dataset.comAngle) * Math.PI) / 180;

    const size = Math.round(Math.min(600,
      Math.max(150, 2 * (radius + PLATE_OUT) * Math.sin(PLATE_SPAN / 2) + 28)));
    const c = size / 2;
    svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
    svg.setAttribute("width", size);
    svg.setAttribute("height", size);

    const cx = c - Math.cos(angle) * radius; // token center, button-local
    const cy = c - Math.sin(angle) * radius;
    path.setAttribute("d", platePath(
      cx, cy,
      radius - 2, radius + PLATE_OUT,
      angle - PLATE_SPAN / 2, angle + PLATE_SPAN / 2
    ));

    btn.style.setProperty("--com-ra-ix", `${(Math.cos(angle) * PLATE_ICON_OFFSET).toFixed(1)}px`);
    btn.style.setProperty("--com-ra-iy", `${(Math.sin(angle) * PLATE_ICON_OFFSET).toFixed(1)}px`);
  }
}

/** Annular sector between radii r0 (inner) and r1 (outer) from a0 to a1. */
function platePath(cx, cy, r0, r1, a0, a1) {
  const p = (r, a) =>
    `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`;
  return [
    `M ${p(r0, a0)}`,
    `A ${r0.toFixed(2)} ${r0.toFixed(2)} 0 0 1 ${p(r0, a1)}`,
    `L ${p(r1, a1)}`,
    `A ${r1.toFixed(2)} ${r1.toFixed(2)} 0 0 0 ${p(r1, a0)}`,
    "Z"
  ].join(" ");
}

/* -------------------------------------------- */
/* Follow loop                                  */
/* -------------------------------------------- */

/**
 * Per-frame tracking of the active token's projected position. Hook-based
 * refresh alone lagged behind moves (the ring was left at the old spot),
 * so while the ring is visible this continuously re-anchors it — covering
 * move animations, native drags and camera pans/zooms alike.
 */
let _lastFollowKey = null;

function followLoop() {
  requestAnimationFrame(followLoop);
  if (!_container?.classList.contains("com-visible")) return;
  const token = radialToken();
  if (!token) return;
  const zoom = canvas.stage?.scale?.x ?? 1;
  const client = canvas.clientCoordinatesFromCanvas(visualCenter(token));
  const key = `${Math.round(client.x)},${Math.round(client.y)},${Math.round(zoom * 100)}`;
  if (key === _lastFollowKey) return;
  _lastFollowKey = key;
  positionContainer(token);
}

/* -------------------------------------------- */
/* Actions                                      */
/* -------------------------------------------- */

/**
 * Run one of the ring actions. Targets the user's controlled token, or
 * the active combatant's token when nothing else is controlled. Hotkeys
 * never command an AI-controlled unit — those turns are spectated.
 */
export function performAction(id) {
  const active = H.activeToken();
  const token = canvas.tokens.controlled[0] ?? active;
  if (!token) return;
  if (H.isAIControlled(token) && token === active) return;

  switch (id) {
    case "move":
      toggleMoveMode(token);
      break;
    case "attack": {
      const target = game.user.targets.first();
      if (!target) {
        enterAttackMode(token); // crosshair mode: click an enemy to fire
        return;
      }
      attackAction(token, target).then(() => H.clearTargets());
      break;
    }
    case "overwatch":
      enterOverwatchFacing(token);
      break;
    case "endTurn":
      endTurn();
      break;
  }
}

/**
 * Wall cover: Foundry walls get a "cover height" flag (none / half /
 * three-quarter / full), and shots at a unit hugging such a wall suffer a
 * hit penalty — XCOM-style cover without changing how walls otherwise
 * behave. Sight and movement stay standard per wall: a low fence is
 * usually sight-transparent, while a wall set to block sight needs no
 * cover level at all (no sight means no shot).
 *
 * A wall protects a defender when the attack line crosses it AND the wall
 * hugs the defender (its closest point lies within COVER_HUG_RADIUS grid
 * cells of the defender's center). So only the wall the defender stands
 * against counts — never a mid-field fence the shot flies over, and never
 * a wall behind the target relative to the shooter.
 */
import { SQ } from "./config.mjs";
import * as H from "./helpers.mjs";

const LEVEL_KEYS = ["None", "Half", "ThreeQuarter", "Full"];

/** The wall's cover level (0–3), or 0 when unset. */
export function wallCoverLevel(wallDoc) {
  return Math.clamp(Number(wallDoc?.getFlag?.(SQ.id, "cover") ?? 0) || 0, 0, 3);
}

/**
 * Flagged cover segments of the active scene as
 * { a, b, level, openDoor } — cached, invalidated on any wall change
 * (flag or door state updates both arrive as updateWall).
 */
let _coverWalls = null;

function coverWalls() {
  if (_coverWalls) return _coverWalls;
  _coverWalls = [];
  for (const w of canvas.walls.placeables) {
    const doc = w.document;
    const level = wallCoverLevel(doc);
    if (level <= 0) continue;
    const openDoor = !!doc.door && doc.ds === CONST.WALL_DOOR_STATES.OPEN;
    _coverWalls.push({
      a: { x: doc.c[0], y: doc.c[1] },
      b: { x: doc.c[2], y: doc.c[3] },
      level,
      openDoor
    });
  }
  return _coverWalls;
}

/** Forget cached cover walls (walls created, moved, re-flagged). */
export function invalidateCoverCache() {
  _coverWalls = null;
}

/**
 * Best cover level (0–3) `target` gets against an attack from `attacker`.
 * Open doors never give cover even while flagged.
 */
export function coverLevelAgainst(attacker, target) {
  if (!attacker?.actor || !target?.actor || !canvas?.walls) return 0;
  const a = H.tokenCenter(attacker);
  const t = H.tokenCenter(target);
  const hug = SQ.COVER_HUG_RADIUS * canvas.grid.size;
  let best = 0;
  for (const w of coverWalls()) {
    if (w.openDoor) continue;
    if (!foundry.utils.lineSegmentIntersection(a, t, w.a, w.b)) continue;
    const cp = closestPointOnSegment(t, w.a, w.b);
    if (Math.hypot(cp.x - t.x, cp.y - t.y) <= hug) {
      best = Math.max(best, w.level);
    }
  }
  return best;
}

/** Hit penalty in percent that a given cover level grants the defender. */
export function coverBonus(level) {
  return SQ.COVER_BONUS[level] ?? 0;
}

/** Localized name of a cover level. */
export function coverLabel(level) {
  return game.i18n.localize(`COM.Cover.Level${LEVEL_KEYS[level] ?? "None"}`);
}

/* -------------------------------------------- */
/* Wall config dropdown                         */
/* -------------------------------------------- */

export function registerCover() {
  for (const hook of ["createWall", "updateWall", "deleteWall"]) {
    Hooks.on(hook, () => invalidateCoverCache());
  }

  // Add a "Cover Height" dropdown to the standard wall config; the select
  // name (flags.com.cover) flows through the form's expandObject into the
  // wall document like any core field. In V14 the render hook receives the
  // config's <form> element itself — older cores receive the app root, so
  // handle both.
  Hooks.on("renderWallConfig", (app, element) => {
    const doc = app.document;
    const form = element?.matches?.("form") ? element : element?.querySelector?.("form");
    if (!form || form.querySelector("[name='flags.com.cover']")) return;
    const current = wallCoverLevel(doc);
    const levels = [0, 1, 2, 3];
    const group = document.createElement("div");
    group.className = "form-group com-cover-group";
    group.innerHTML =
      `<label>${game.i18n.localize("COM.Cover.Name")}</label>` +
      `<div class="form-fields"><select name="flags.com.cover">` +
      levels.map((l) =>
        `<option value="${l}" ${l === current ? "selected" : ""}>${coverLabel(l)}</option>`
      ).join("") +
      `</select></div>` +
      `<p class="hint">${game.i18n.localize("COM.Cover.Hint")}</p>`;
    const footer = form.querySelector("footer");
    if (footer) footer.before(group);
    else form.appendChild(group);
  });
}

/* -------------------------------------------- */
/* Geometry                                     */
/* -------------------------------------------- */

function closestPointOnSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy || 1;
  const t = Math.clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2, 0, 1);
  return { x: a.x + t * dx, y: a.y + t * dy };
}

/**
 * Uniform inline SVG icon set for the tactical action controls.
 *
 * The free Font Awesome solid glyphs mix very different visual densities
 * (airy crosshair, heavy blobbed eye, busy checkerboard flag), so controls
 * side by side never looked like one family. These four share a single
 * style instead: 24×24 grid, 2px rounded strokes, `currentColor` so all
 * existing color/hover rules keep working.
 */

const svg = (cls, inner) =>
  `<svg class="com-icon${cls ? ` ${cls}` : ""}" viewBox="0 0 24 24" fill="none" ` +
  `stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ` +
  `aria-hidden="true">${inner}</svg>`;

const PATHS = {
  // Runner mid-stride.
  move:
    `<circle cx="14.4" cy="4.4" r="2"/>` +
    `<path d="M12.4 8.6 10.2 13.2"/>` +
    `<path d="M12.4 8.6 15.8 10.4 18 13"/>` +
    `<path d="M12.4 8.6 9 10.2 6.6 9"/>` +
    `<path d="M10.2 13.2 13.8 15.4 13.2 19.6"/>` +
    `<path d="M10.2 13.2 7.2 15 6.4 18.6"/>`,
  // Crosshair with ticks and center dot.
  attack:
    `<circle cx="12" cy="12" r="6.6"/>` +
    `<path d="M12 2.4v3M12 18.6v3M2.4 12h3M18.6 12h3"/>` +
    `<circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none"/>`,
  // Eye outline with pupil.
  overwatch:
    `<path d="M2.4 12C5.2 7 8.4 4.9 12 4.9s6.8 2.1 9.6 7.1c-2.8 5-6 7.1-9.6 7.1S5.2 17 2.4 12Z"/>` +
    `<circle cx="12" cy="12" r="3.2"/>`,
  // Banner on a pole.
  endTurn:
    `<path d="M5.6 21V4"/>` +
    `<path d="M5.6 4.6h13l-2.7 3.5 2.7 3.5h-13"/>`
};

/** Icon markup; `cls` adds a class alongside the shared `com-icon`. */
export function comIcon(name, cls = "") {
  return PATHS[name] ? svg(cls, PATHS[name]) : "";
}

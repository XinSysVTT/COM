/**
 * Cover props: pre-made placeable cover objects (crates, sandbags, barrels,
 * shipping containers). A GM-only palette lists the presets; dragging one
 * onto the scene drops an actorless neutral token carrying a `flags.com.prop`
 * cover level. cover.mjs treats that token's footprint as four cover edges —
 * the same rule flagged walls use — while the rest of the system treats the
 * token like any object: AI ignores it (not hostile), it cannot be shot
 * (no actor, neutral), and its cells block COM pathfinding.
 */
import { SQ } from "./config.mjs";
import * as H from "./helpers.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Preset props, in palette order. w/h in grid cells, level 1–3. */
const PROPS = {
  crate: { key: "crate", w: 1, h: 1, level: 1 },
  sandbags: { key: "sandbags", w: 1, h: 1, level: 1 },
  barrel: { key: "barrel", w: 1, h: 1, level: 2 },
  container: { key: "container", w: 2, h: 1, level: 3 }
};

function propList() {
  return Object.values(PROPS).map((def) => ({
    ...def,
    name: game.i18n.localize(`COM.Props.${def.key}`),
    img: `systems/${SQ.id}/assets/props/${def.key}.svg`,
    size: `${def.w}×${def.h}`,
    levelLabel: coverLevelLabel(def.level)
  }));
}

function coverLevelLabel(level) {
  const keys = ["None", "Half", "ThreeQuarter", "Full"];
  return game.i18n.localize(`COM.Cover.Level${keys[level]}`);
}

/* -------------------------------------------- */
/* Palette window                               */
/* -------------------------------------------- */

let _palette = null;

class PropsPalette extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "com-props",
    tag: "div",
    classes: ["com-props"],
    window: { title: "COM.Props.Title", icon: "fas fa-box-open" },
    position: { width: 340 }
  };

  static PARTS = {
    main: { template: `systems/${SQ.id}/templates/props.html` }
  };

  /** @override */
  _prepareContext(options) {
    return { props: propList(), hint: game.i18n.localize("COM.Props.Hint") };
  }

  /** @override — make every prop card a drag source. */
  async _onRender(context, options) {
    for (const el of this.element.querySelectorAll(".com-prop[draggable]")) {
      el.addEventListener("dragstart", (ev) => {
        ev.dataTransfer.setData(
          "text/plain",
          JSON.stringify({ type: "com-prop", prop: el.dataset.prop })
        );
        ev.dataTransfer.effectAllowed = "copy";
      });
    }
  }
}

/** Show the palette (creating it on first use). */
export function openPropsPalette() {
  _palette ??= new PropsPalette();
  _palette.render({ force: true }).catch((err) => {
    console.error("COM: props palette failed to render", err);
  });
  return _palette;
}

/** Toggle the palette from the launcher button. */
export function togglePropsPalette() {
  if (_palette?.rendered) _palette.close();
  else openPropsPalette();
}

/* -------------------------------------------- */
/* Placing                                      */
/* -------------------------------------------- */

/**
 * Turn a canvas drop into an actorless prop token, centered on the cursor
 * and snapped to the grid so footprints line up with cells.
 */
async function placeProp(data) {
  const def = PROPS[data.prop];
  if (!def || !canvas.ready || !canvas.scene) return;
  if (!Number.isFinite(data.x) || !Number.isFinite(data.y)) {
    console.warn("COM: prop drop without coordinates", data);
    return;
  }
  const size = canvas.grid.size;
  const topLeft = {
    x: data.x - (def.w * size) / 2,
    y: data.y - (def.h * size) / 2
  };
  const at = canvas.grid.getSnappedPoint(topLeft);
  const name = game.i18n.localize(`COM.Props.${def.key}`);
  await canvas.scene.createEmbeddedDocuments("Token", [{
    name,
    x: at.x,
    y: at.y,
    width: def.w,
    height: def.h,
    texture: { src: `systems/${SQ.id}/assets/props/${def.key}.svg` },
    disposition: CONST.TOKEN_DISPOSITIONS.NEUTRAL,
    sight: { enabled: false },
    displayBars: CONST.TOKEN_DISPLAY_MODES.NONE,
    displayName: CONST.TOKEN_DISPLAY_MODES.HOVER,
    flags: { [SQ.id]: { prop: def.level } }
  }]);
  ui.notifications.info(game.i18n.format("COM.Props.Placed", { name }));
}

/* -------------------------------------------- */
/* Registration                                 */
/* -------------------------------------------- */

export function registerProps() {
  // Older cores whitelist canvas drops by type before calling the
  // dropCanvasData hook (v13.340+ fires the hook regardless); register ours
  // so the drop is recognized everywhere.
  const dropTypes = CONFIG.Canvas?.dropTypes;
  if (dropTypes && !dropTypes["com-prop"]) {
    dropTypes["com-prop"] = { label: "COM Cover Prop" };
  }

  // Consume our custom drag data before core tries to make sense of it.
  Hooks.on("dropCanvasData", (canvasObj, data) => {
    if (data?.type !== "com-prop" || !game.user.isGM) return;
    placeProp(data).catch((err) => console.error("COM: could not place prop", err));
    return false;
  });

  Hooks.once("ready", () => {
    if (!game.user.isGM) return;
    const btn = document.createElement("button");
    btn.id = "com-props-open";
    btn.title = game.i18n.localize("COM.Props.Open");
    btn.innerHTML = '<i class="fas fa-box-open"></i>';
    btn.addEventListener("click", () => togglePropsPalette());
    document.body.appendChild(btn);
  });
}

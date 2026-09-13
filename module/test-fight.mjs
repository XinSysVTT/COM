/**
 * Test Fight: a GM settings menu that builds a dedicated arena map and
 * starts a generic 2v2 combat in one click — two friendly troopers vs two
 * hostiles, everyone at full health. The arena scene and its actors are
 * reused, so running it again simply resets the same fight.
 */
import { SQ } from "./config.mjs";
import * as H from "./helpers.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const ARENA_NAME = "Test Fight Arena";
const CELLS = { cols: 24, rows: 16, cell: 100 };

const UNITS = [
  { name: "Trooper 1", hostile: false, col: 3, row: 3 },
  { name: "Trooper 2", hostile: false, col: 3, row: 8 },
  { name: "Raider 1", hostile: true, col: CELLS.cols - 4, row: 3 },
  { name: "Raider 2", hostile: true, col: CELLS.cols - 4, row: 8 }
];

class TestFightMenu extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "com-test-fight",
    tag: "div",
    window: { title: "COM.TestFight.Title", contentClasses: ["standard-form"] },
    position: { width: 420 },
    actions: { start: TestFightMenu.#onStart }
  };

  static PARTS = {
    main: { template: `systems/${SQ.id}/templates/test-fight.html` }
  };

  static #onStart() {
    startTestFight();
    this.close();
  }
}

export function registerTestFight() {
  game.settings.registerMenu(SQ.id, "testFight", {
    name: game.i18n.localize("COM.TestFight.SettingName"),
    label: game.i18n.localize("COM.TestFight.Button"),
    hint: game.i18n.localize("COM.TestFight.Hint"),
    icon: "fas fa-khanda",
    type: TestFightMenu,
    restricted: true
  });
}

/* -------------------------------------------- */
/* The fight itself                             */
/* -------------------------------------------- */

async function startTestFight() {
  const scene = await ensureArenaScene();
  const size = canvas.grid.size;
  const tokens = [];

  for (const unit of UNITS) {
    const actor = await ensureActor(unit);
    const x = unit.col * size;
    const y = unit.row * size;
    tokens.push(await ensureToken(actor, x, y, scene));
  }

  // Everyone at full health, fresh AP, no downed state, no overwatch.
  for (const t of tokens) {
    const actor = t.actor ?? game.actors.get(t.actorId);
    await actor?.update({
      "system.hp.value": actor.system.hp.max,
      "system.ap.value": actor.system.ap.max
    });
  }

  // Fresh encounter with exactly these four.
  if (game.combat) await game.combat.delete();
  const combat = await Combat.create({ scene: scene.id });
  await combat.createEmbeddedDocuments("Combatant",
    tokens.map((t) => ({ tokenId: t.id, actorId: t.actor?.id ?? t.actorId, hidden: false })));
  await combat.startCombat();
  // startCombat's active flag can lag behind its round/turn updates — give
  // the state a moment to settle, then force activation if it never landed.
  await new Promise((r) => setTimeout(r, 300));
  if (!game.combat?.active) await game.combat.update({ active: true });

  await H.notify("COM.TestFight.Started", "info");
}

/** Create (once) or reuse the arena scene, clear it, and switch the view. */
async function ensureArenaScene() {
  // V14 deprecated Scene#title — the display name lives in `name`.
  let scene = game.scenes.find((s) => s.name === ARENA_NAME);
  if (!scene) {
    scene = await Scene.create({
      name: ARENA_NAME,
      width: CELLS.cols * CELLS.cell,
      height: CELLS.rows * CELLS.cell,
      padding: 0,
      grid: { size: CELLS.cell, type: 1 },
      background: { src: null }
    });
  } else if (scene.tokens.size) {
    await scene.deleteEmbeddedDocuments("Token", scene.tokens.map((t) => t.id));
  }
  await scene.activate();
  // Wait until this client is actually viewing the new scene.
  for (let i = 0; i < 40; i++) {
    if (canvas.ready && canvas.scene?.id === scene.id) return scene;
    await new Promise((r) => setTimeout(r, 200));
  }
  return scene;
}

async function ensureActor(unit) {
  let actor = game.actors.find((a) => a.name === unit.name);
  if (!actor) {
    actor = await Actor.create({
      name: unit.name,
      type: "unit",
      img: "icons/svg/mystery-man.svg",
      prototypeToken: {
        name: unit.name,
        disposition: unit.hostile ? CONST.TOKEN_DISPOSITIONS.HOSTILE : CONST.TOKEN_DISPOSITIONS.FRIENDLY,
        width: 1,
        height: 1
      },
      system: {
        hp: { value: 10, max: 10 },
        ap: { value: 2, max: 2 },
        aim: 65,
        defense: 10,
        speed: 4
      }
    });
  }
  if (!actor.items.some((i) => i.type === "weapon")) {
    await Item.create({
      name: "Rifle",
      type: "weapon",
      system: { damage: "1d6+2", range: 12, equipped: true }
    }, { parent: actor });
  }
  return actor;
}

async function ensureToken(actor, x, y, scene) {
  // Match on the raw actorId — the resolved `actor` reference can lag on a
  // freshly created token, which would otherwise spawn duplicates.
  const existing = scene.tokens.find((t) => t.actorId === actor.id);
  if (existing) {
    await existing.update({ x, y });
    return existing;
  }
  const [doc] = await scene.createEmbeddedDocuments("Token", [{
    name: actor.name,
    actorId: actor.id,
    x,
    y,
    disposition: actor.prototypeToken.disposition,
    width: 1,
    height: 1
  }]);
  return doc;
}

/**
 * COM Arsenal compendium bootstrap.
 *
 * Ships as plain JSON documents (packs/com-weapons/*.json). On the first
 * world load the system creates a world-level compendium and imports them,
 * so every world running COM gets the arsenal without any manual setup.
 * The pack is only created when it does not exist yet — deleting it in the
 * compendium browser is respected until the next bootstrapped world.
 */
import { SQ } from "./config.mjs";

const PACK_NAME = "com-weapons";
const PACK_KEY = `world.${PACK_NAME}`;
const FILES = [
  "combat-knife", "sidearm-pistol", "smg", "combat-shotgun",
  "assault-rifle", "sniper-rifle", "frag-grenade", "rocket-launcher"
];

export function registerArsenal() {
  Hooks.once("setup", () => {
    bootstrapArsenal().catch((err) => console.error("COM: arsenal bootstrap failed", err));
  });
}

async function bootstrapArsenal() {
  if (game.packs.get(PACK_KEY)) return;
  if (!game.user.isGM) return;

  const pack = await CompendiumCollection.createCompendium({
    name: PACK_NAME,
    label: "COM Arsenal",
    type: "Item"
  });
  if (!pack) return;

  for (const file of FILES) {
    try {
      const res = await fetch(`systems/${SQ.id}/packs/${PACK_NAME}/${file}.json`);
      if (!res.ok) throw new Error(`fetch ${res.status}`);
      const doc = await res.json();
      await Item.create({
        name: doc.name,
        type: doc.type,
        img: doc.img,
        system: {
          damage: doc.system.damage,
          range: doc.system.range,
          equipped: false,
          description: doc.system.description ?? ""
        }
      }, { pack: PACK_KEY });
    } catch (err) {
      console.error(`COM: could not import ${file} into the arsenal`, err);
    }
  }
  console.log(`COM: imported ${FILES.length} weapons into the COM Arsenal.`);
}

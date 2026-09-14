/**
 * The unit actor sheet: HP/AP/aim/defense/speed, weapon list, description.
 */
import { SQ } from "../config.mjs";
import * as H from "../helpers.mjs";

const api = foundry.applications.api;
const SheetBase = api.HandlebarsApplicationMixin(api.DocumentSheetV2);

/** Effective "AI plays this unit" state, honoring the legacy noAI flag. */
function aiControlsUnit(actor) {
  return H.isAIControlled(actor);
}

export class UnitSheet extends SheetBase {
  static DEFAULT_OPTIONS = {
    classes: [SQ.id, "sheet", "unit"],
    position: { width: 520 },
    window: { contentClasses: ["standard-form"] },
    form: { submitOnChange: true },
    actions: {
      addWeapon: UnitSheet.#onAddWeapon,
      editWeapon: UnitSheet.#onEditWeapon,
      deleteWeapon: UnitSheet.#onDeleteWeapon,
      toggleWeapon: UnitSheet.#onToggleWeapon,
      pickImage: UnitSheet.#onPickImage
    }
  };

  static PARTS = {
    main: {
      template: `systems/${SQ.id}/templates/unit-sheet.html`
    }
  };

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const weapons = this.document.items
      .filter((i) => i.type === "weapon")
      .map((i) => ({
        id: i.id,
        name: i.name,
        img: i.img,
        damage: i.system.damage,
        range: i.system.range,
        equipped: i.system.equipped
      }));
    // The actor's prototype disposition is the source of truth for which
    // side the unit fights on; placed tokens follow via updateActor.
    const disposition = this.document.prototypeToken?.disposition
      ?? CONST.TOKEN_DISPOSITIONS.NEUTRAL;
    const sideOptions = [
      { value: CONST.TOKEN_DISPOSITIONS.FRIENDLY, label: game.i18n.localize("COM.Side.Friendly") },
      { value: CONST.TOKEN_DISPOSITIONS.NEUTRAL, label: game.i18n.localize("COM.Side.Neutral") },
      { value: CONST.TOKEN_DISPOSITIONS.HOSTILE, label: game.i18n.localize("COM.Side.Enemy") }
    ].map((o) => ({ ...o, selected: o.value === disposition }));
    const sideClass = disposition === CONST.TOKEN_DISPOSITIONS.HOSTILE
      ? "com-enemy"
      : disposition === CONST.TOKEN_DISPOSITIONS.NEUTRAL ? "com-neutral" : "com-player";
    const sideLabel = game.i18n.localize(
      disposition === CONST.TOKEN_DISPOSITIONS.HOSTILE
        ? "COM.Side.Enemy"
        : disposition === CONST.TOKEN_DISPOSITIONS.NEUTRAL
          ? "COM.Side.Neutral"
          : "COM.Side.Friendly"
    );
    return Object.assign(context, {
      system: this.document.system,
      weapons,
      hasWeapons: weapons.length > 0,
      aiControlled: aiControlsUnit(this.document),
      isGM: game.user.isGM,
      downed: this.document.system.hp.value <= 0,
      sideOptions,
      sideLabel,
      factionClass: sideClass
    });
  }

  /**
   * @override
   * Unchecked checkboxes are absent from FormData; force the AI-controlled
   * flag so toggling it off actually clears it.
   */
  _prepareSubmitData(event, form, formData) {
    const data = super._prepareSubmitData(event, form, formData);
    data.flags = data.flags ?? {};
    data.flags.com = Object.assign({}, data.flags.com, {
      aiControlled: !!form.querySelector('input[name="flags.com.aiControlled"]')?.checked
    });
    return data;
  }

  /**
   * @override
   * Accept weapon items dropped onto the sheet — most usefully from the
   * COM Arsenal compendium. The first weapon a unit receives is auto-
   * equipped; drops of items this actor already owns are ignored.
   */
  async _onDrop(event) {
    const result = await super._onDrop?.(event);
    let data = null;
    try {
      data = JSON.parse(event.dataTransfer?.getData("text/plain") ?? "null");
    } catch {
      return result; // not a document drop
    }
    if (data?.type !== "Item") return result;

    const item = await Item.fromDropData(data);
    if (item?.type !== "weapon") return result;
    if (item.parent?.documentName === "Actor") return result; // already owned

    const hasEquipped = this.document.items.some(
      (i) => i.type === "weapon" && i.system.equipped
    );
    await Item.create({
      name: item.name,
      type: "weapon",
      img: item.img,
      system: {
        damage: item.system.damage,
        range: item.system.range,
        equipped: !hasEquipped,
        description: item.system.description ?? ""
      }
    }, { parent: this.document });
    return true;
  }

  /* -------------------------------------------- */
  /* Actions                                      */
  /* -------------------------------------------- */

  static #onAddWeapon() {
    Item.create({
      name: game.i18n.localize("COM.Weapon.NewWeapon"),
      type: "weapon"
    }, { parent: this.document });
  }

  static #onEditWeapon(event, target) {
    const id = target.closest("[data-item-id]")?.dataset.itemId;
    this.document.items.get(id)?.sheet.render(true);
  }

  static #onDeleteWeapon(event, target) {
    const id = target.closest("[data-item-id]")?.dataset.itemId;
    if (id) this.document.deleteEmbeddedDocuments("Item", [id]);
  }

  static #onToggleWeapon(event, target) {
    const id = target.closest("[data-item-id]")?.dataset.itemId;
    const item = this.document.items.get(id);
    if (item) item.update({ "system.equipped": !item.system.equipped });
  }

  static #onPickImage() {
    const fp = new FilePicker({
      type: "image",
      current: this.document.img,
      callback: (path) => this.document.update({ img: path })
    });
    fp.render(true);
  }
}

/**
 * Keep placed tokens in step with the sheet's side selector: when an actor's
 * prototype disposition changes, push it onto every token of that actor in
 * every scene. Linked tokens would follow on their own; this covers the
 * unlinked copies most COM worlds are built from.
 */
Hooks.on("updateActor", (actor, change) => {
  if (!game.user.isGM) return;
  const disp = change?.prototypeToken?.disposition;
  if (disp === undefined) return;
  for (const scene of game.scenes) {
    const updates = scene.tokens
      .filter((t) => t.actorId === actor.id && t.disposition !== disp)
      .map((t) => ({ _id: t.id, disposition: disp }));
    if (updates.length) {
      scene.updateEmbeddedDocuments("Token", updates)
        .catch((err) => console.warn("COM: side sync failed", err));
    }
  }
});

/**
 * The unit actor sheet: HP/AP/aim/defense/speed, weapon list, description.
 */
import { SQ } from "../config.mjs";

const api = foundry.applications.api;
const SheetBase = api.HandlebarsApplicationMixin(api.DocumentSheetV2);

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
    // Faction badge: derived from this actor's token in the viewed scene.
    const sceneToken = canvas.tokens?.placeables?.find((t) => t.actor === this.document);
    const hostile = sceneToken?.document.disposition === CONST.TOKEN_DISPOSITIONS.HOSTILE;
    return Object.assign(context, {
      system: this.document.system,
      weapons,
      hasWeapons: weapons.length > 0,
      noAI: !!this.document.getFlag("com", "noAI"),
      isGM: game.user.isGM,
      downed: this.document.system.hp.value <= 0,
      faction: sceneToken
        ? game.i18n.localize(hostile ? "COM.Sheet.EnemySide" : "COM.Sheet.PlayerSide")
        : null,
      factionClass: hostile ? "com-enemy" : "com-player"
    });
  }

  /**
   * @override
   * Unchecked checkboxes are absent from FormData; force the noAI flag to
   * false so toggling the opt-out off actually clears it.
   */
  _prepareSubmitData(event, form, formData) {
    const data = super._prepareSubmitData(event, form, formData);
    data.flags = data.flags ?? {};
    data.flags.com = Object.assign({}, data.flags.com, {
      noAI: !!form.querySelector('input[name="flags.com.noAI"]')?.checked
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

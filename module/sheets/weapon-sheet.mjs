/**
 * The weapon item sheet: damage formula, range, equipped state.
 */
import { SQ } from "../config.mjs";

const api = foundry.applications.api;
const SheetBase = api.HandlebarsApplicationMixin(api.DocumentSheetV2);

export class WeaponSheet extends SheetBase {
  static DEFAULT_OPTIONS = {
    classes: [SQ.id, "sheet", "weapon"],
    position: { width: 440 },
    window: { contentClasses: ["standard-form"] },
    form: { submitOnChange: true }
  };

  static PARTS = {
    main: {
      template: `systems/${SQ.id}/templates/weapon-sheet.html`
    }
  };

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    return Object.assign(context, {
      system: this.document.system
    });
  }
}

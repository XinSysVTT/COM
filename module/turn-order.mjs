/**
 * The turn order HUD: an XCOM-style strip at the top of the screen showing
 * the round number, the active phase, and a tile per unit in initiative
 * order (portrait, HP bar, AP pips, overwatch badge; active/acted/defeated
 * states). Tiles are clickable to focus that unit's token.
 *
 * The strip is draggable (grab the round box), resizable (− / + controls,
 * shown on hover) and hideable (✕, restored via the small pill that stays
 * behind). Position, scale and visibility are remembered per client.
 */
import { SQ } from "./config.mjs";
import * as H from "./helpers.mjs";

const api = foundry.applications.api;

const SCALE = { min: 0.7, max: 1.6, step: 0.15 };
const DRAG_THRESHOLD = 5;

export function registerTurnOrderSettings() {
  game.settings.register(SQ.id, "turnOrderPos", {
    scope: "client", config: false, type: Object, default: {}
  });
  game.settings.register(SQ.id, "turnOrderScale", {
    scope: "client", config: false, type: Number, default: 1
  });
  game.settings.register(SQ.id, "turnOrderHidden", {
    scope: "client", config: false, type: Boolean, default: false
  });
}

export class TurnOrderHud extends api.HandlebarsApplicationMixin(api.ApplicationV2) {
  _dragging = false;
  _dragMoved = false;

  static DEFAULT_OPTIONS = {
    id: "com-turn-order",
    tag: "aside",
    classes: ["com-turn-order-app"],
    positioned: false,
    window: {
      frame: false
    },
    actions: {
      focusUnit: TurnOrderHud.#onFocusUnit,
      scaleUp: TurnOrderHud.#onScaleUp,
      scaleDown: TurnOrderHud.#onScaleDown,
      hidePanel: TurnOrderHud.#onHidePanel,
      restorePanel: TurnOrderHud.#onRestorePanel
    }
  };

  static PARTS = {
    root: {
      template: `systems/${SQ.id}/templates/turn-order.html`
    }
  };

  /** @override */
  async _prepareContext(options) {
    const combat = game.combat;
    if (!combat?.active) return { active: false };

    const activeId = combat.combatant?.id ?? null;
    const activeSide = H.sideOf(combat.combatant?.token);
    const units = combat.turns.map((c, idx) => {
      const sys = c.actor?.system ?? {};
      const hpMax = Math.max(1, sys.hp?.max ?? 1);
      const pips = [];
      for (let i = 0; i < (sys.ap?.max ?? 0); i++) {
        pips.push({ filled: i < (sys.ap?.value ?? 0) });
      }
      return {
        id: c.id,
        tokenId: c.token?.id ?? null,
        name: c.name,
        img: c.token?.texture?.src ?? c.actor?.img ?? CONST.DEFAULT_TOKEN,
        side: H.sideOf(c.token),
        isActive: c.id === activeId,
        hasActed: idx < (combat.turn ?? 0),
        defeated: c.isDefeated,
        overwatch: !!sys.overwatch,
        hp: sys.hp?.value ?? 0,
        hpMax: sys.hp?.max ?? 0,
        hpPct: Math.round((100 * Math.max(0, sys.hp?.value ?? 0)) / hpMax),
        pips
      };
    });

    return {
      active: true,
      round: combat.round,
      phase: activeSide,
      phaseLabel: game.i18n.localize(
        activeSide === H.SIDE.ENEMY ? "COM.TurnOrder.EnemyPhase"
        : activeSide === H.SIDE.NEUTRAL ? "COM.TurnOrder.NeutralPhase"
        : "COM.TurnOrder.PlayerPhase"
      ),
      scale: game.settings.get(SQ.id, "turnOrderScale") ?? 1,
      hidden: game.settings.get(SQ.id, "turnOrderHidden") ?? false,
      units
    };
  }

  /** @override — restore saved position and wire up dragging. */
  async _onRender(context, options) {
    await super._onRender(context, options);
    const el = this.element;
    if (!el) return;

    const pos = game.settings.get(SQ.id, "turnOrderPos") ?? {};
    if (Number.isFinite(pos.left) && Number.isFinite(pos.top)) {
      this.#place(pos.left, pos.top);
    } else {
      // Default: top middle of the screen.
      const width = el.offsetWidth || 320;
      this.#place(Math.round((window.innerWidth - width) / 2), 8);
    }
    this.#wireDrag();
  }

  /** Position through ApplicationV2 so it sticks across re-renders. */
  #place(left, top) {
    this.setPosition({
      left: Math.clamp(Math.round(left), 0, Math.max(0, window.innerWidth - 60)),
      top: Math.clamp(Math.round(top), 0, Math.max(0, window.innerHeight - 40))
    });
  }

  /** Drag surfaces: the round box (strip) and the restore pill. */
  #wireDrag() {
    const el = this.element;
    const surface = el.querySelector(".com-to-round, .com-to-pill");
    if (!surface || surface.dataset.comDragWired) return;
    surface.dataset.comDragWired = "1";

    surface.addEventListener("pointerdown", (ev) => {
      if (ev.button !== 0) return;
      const rect = el.getBoundingClientRect();
      const offX = ev.clientX - rect.left;
      const offY = ev.clientY - rect.top;
      const start = { x: ev.clientX, y: ev.clientY };
      this._dragging = true;
      this._dragMoved = false;

      const onMove = (e) => {
        if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > DRAG_THRESHOLD) {
          this._dragMoved = true;
        }
        this.#place(e.clientX - offX, e.clientY - offY);
      };
      const onUp = async () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        this._dragging = false;
        const r = el.getBoundingClientRect();
        await game.settings.set(SQ.id, "turnOrderPos", {
          left: Math.round(r.left),
          top: Math.round(r.top)
        });
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      ev.preventDefault();
    });

    // A drag that ended on the pill/round box must not count as a click:
    // swallow the trailing click event entirely.
    surface.addEventListener("click", (ev) => {
      if (this._dragMoved) {
        ev.stopPropagation();
        ev.preventDefault();
        this._dragMoved = false;
      }
    }, true);
  }

  /* -------------------------------------------- */
  /* Actions                                      */
  /* -------------------------------------------- */

  static #onFocusUnit(event, target) {
    const tokenId = target.closest("[data-token-id]")?.dataset.tokenId;
    const token = canvas.tokens.get(tokenId);
    if (!token) return;
    if (game.user.isGM || token.isOwner) token.control({ releaseOthers: true });
    const doc = token.document;
    canvas.animatePan({ x: doc.x + 50, y: doc.y + 50, duration: 250 });
  }

  static #onScaleUp() {
    this._nudgeScale(SCALE.step);
  }

  static #onScaleDown() {
    this._nudgeScale(-SCALE.step);
  }

  static #onHidePanel() {
    game.settings.set(SQ.id, "turnOrderHidden", true)
      .then(() => this.render({ force: true }));
  }

  static #onRestorePanel() {
    game.settings.set(SQ.id, "turnOrderHidden", false)
      .then(() => this.render({ force: true }));
  }

  _nudgeScale(delta) {
    const current = game.settings.get(SQ.id, "turnOrderScale") ?? 1;
    const next = Math.round(
      Math.clamp(current + delta, SCALE.min, SCALE.max) * 100
    ) / 100;
    if (next === current) return;
    game.settings.set(SQ.id, "turnOrderScale", next)
      .then(() => this.render({ force: true }));
  }
}

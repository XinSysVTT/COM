/**
 * Battle-mode UI toggle: a small button in the bottom-left corner (plus a
 * B hotkey) that hides Foundry's standard interface — tools, players list,
 * scene navigation, hotbar, sidebar — so the scene reads like a video game.
 * The COM HUDs (tactical actions + turn order) stay visible.
 * The preference is stored per client.
 */
import { SQ } from "./config.mjs";

let _hidden = false;

function apply(paint) {
  document.body.classList.toggle("com-ui-hidden", _hidden);
  if (typeof paint === "function") paint();
}

export function registerUIToggle() {
  game.settings.register(SQ.id, "hideCoreUI", {
    name: game.i18n.localize("COM.UiToggle.SettingName"),
    scope: "client",
    config: false,
    type: Boolean,
    // Battle mode is the expected way to play: start with the core UI hidden.
    default: true
  });

  game.keybindings.register(SQ.id, "toggleBattleUI", {
    name: game.i18n.localize("COM.UiToggle.KeybindName"),
    hint: game.i18n.localize("COM.UiToggle.KeybindHint"),
    editable: [{ key: "KeyB" }],
    onDown: () => toggleCoreUI()
  });

  Hooks.once("ready", () => {
    const btn = document.createElement("button");
    btn.id = "com-ui-toggle";
    btn.title = game.i18n.localize("COM.UiToggle.Title");
    document.body.appendChild(btn);

    const paint = () => {
      // Eye opens the interface, eye-slash hides it (icon shows the action).
      btn.innerHTML = _hidden
        ? '<i class="fas fa-eye"></i>'
        : '<i class="fas fa-eye-slash"></i>';
    };

    btn.addEventListener("click", () => toggleCoreUI());

    // Keep the button above the players box while the interface is shown.
    const trackPlayersHeight = () => {
      const players = document.getElementById("players");
      const h = players && !players.classList.contains("collapsed")
        ? players.offsetHeight
        : 0;
      document.body.style.setProperty("--com-players-h", `${h}px`);
    };
    if (typeof ResizeObserver === "function") {
      const observer = new ResizeObserver(trackPlayersHeight);
      Hooks.on("renderPlayerList", () => {
        const players = document.getElementById("players");
        if (players) observer.observe(players);
      });
    }
    window.addEventListener("resize", trackPlayersHeight);

    _hidden = game.settings.get(SQ.id, "hideCoreUI") ?? true;
    apply(paint);
    trackPlayersHeight();
  });
}

/** Flip battle mode; UI updates instantly, the preference saves after. */
export function toggleCoreUI() {
  _hidden = !_hidden;
  apply();
  const btn = document.getElementById("com-ui-toggle");
  if (btn) {
    btn.innerHTML = _hidden
      ? '<i class="fas fa-eye"></i>'
      : '<i class="fas fa-eye-slash"></i>';
  }
  game.settings.set(SQ.id, "hideCoreUI", _hidden).catch((err) => {
    console.error("COM: could not persist UI preference", err);
  });
  return _hidden;
}

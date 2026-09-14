# Crisis Operations Management — COM

Crisis Operations Management (**COM**) is a lightweight, **XCOM-style tactical system** for Foundry Virtual Tabletop: side-based turns, AP-driven actions, click-to-move with a highlighted movement range, hit-chance attacks with a live forecast, overwatch cones, wall cover, AI-played turns, explosive props — and a command ring around the active unit so it plays like a video game, not a spreadsheet.

![The command ring around the active unit, an overwatching raider and the turn-order strip](assets/screenshots/hero-command-ring.png)

Designed for *kill-team skirmishes on a square grid*: a handful of units per side, short and punchy fights. Not a simulation — a tactics board.

## A quick tour

### The command ring

Whoever's turn it is gets a **command ring** orbiting their token — four arc plates (Move `1`, Attack `2`, Overwatch `3`, End Turn `F`) plus a COST pill showing the hovered action's AP cost, or the unit's remaining AP when idle. The plates are drawn to hug the token at any zoom level, stay glued to it while panning and zooming, gray out when the action is unavailable, and glow green when their mode is engaged. Everything is reachable by mouse or hotkeys (rebindable in Foundry's keybinding settings).

The **status card** (bottom center) shows the selected unit's portrait, HP and AP; the **turn-order strip** (top center) tracks the whole fight — round number, current phase, and a tile per unit with portrait, HP sliver and AP pips. Active glows green, acted dims, defeated grays out, downed units are skipped automatically.

### Moving

Press **Move** and every tile you can reach lights up: **green** for your current AP, **amber** for what a second AP would buy. Click a tile and the unit walks there. Walls and other tokens block the pathfinding; diagonals included.

![Movement range highlighted in green and amber around the unit](assets/screenshots/move-mode.png)

### Attacking (and knowing the odds first)

Hover any enemy while your unit is selected and a **forecast** follows the cursor: hit chance, weapon damage, and warnings when the target is out of range or hidden behind a wall. Hit chance is `aim − defense − cover`, rolled on d100; damage comes from the equipped weapon.

![Attack forecast showing hit chance, damage and a cover penalty](assets/screenshots/attack-forecast.png)

Press **Attack** and click the enemy: it gets Foundry's targeting reticle (not selection), the shot fires with a muzzle flash and a tracer bolt (melee swings a slash instead), misses visibly deflect past the target, and the result lands in chat.

![Attack chat card with cover penalty, hit chance, roll and result](assets/screenshots/attack-card.png)

### Wall cover

Every wall can be given a **cover height** in the standard wall config: None, Half, Three-Quarter or Full. A unit standing against such a wall is harder to hit from the far side — **Half −20%, Three-Quarter −30%, Full −40%** off the shooter's chance. Only the wall the defender actually stands against counts (the shot line must cross it within a cell of the target), open doors give nothing, and melee ignores cover — so flanking around a fence brings the odds right back.

Cover never changes what a wall blocks: set sight and movement per wall as usual. A low fence is shootable-over; a tall wall that blocks sight needs no cover level at all.

![Cover Height dropdown in the wall config](assets/screenshots/wall-cover-config.png)

### Cover props

No walls where you need cover? The **box button** (bottom-left, GM only) opens the **Cover Props** palette: drag a wooden crate, a sandbag stack, a fuel barrel, a water barrel or a shipping container onto the map and it snaps to the grid as a placeable object. Its footprint acts exactly like a flagged wall — stand against it and shooters on the far side eat the cover penalty (crates and sandbags Half, barrels Three-Quarter, the 2×1 container Full). Props block movement but never sight, and don't take part in the turn order — they're furniture that saves lives.

Props are also **shootable**: pick one as an attack target (they're stationary, so hitting one is easy). Inert props — crates, sandbags, water barrels — just absorb the shot with a dull thunk. The **fuel barrel** is another story entirely.

### Explosive barrels

Shoot a **fuel barrel** and it detonates: a white-hot flash and a rolling fireball, **3d6 blast damage** to every unit within **2 cells**, and any other fuel barrel caught in the blast chain-detonates a beat later. Victims go down exactly like any other damage would put them down, and the barrel itself is destroyed in the process. The hover forecast warns you loudly before you pull the trigger: *⚠ EXPLOSIVE — shooting it detonates it*.

### Sides

The unit sheet has a **side selector** — Friendly, Neutral or Enemy. Changing it re-colors the token ring everywhere and moves the unit to its rightful place in the turn order. **Neutral is a real side, not a gray zone**: the AI ignores neutrals, overwatch cones don't react to them, they count for no victory, and they sort after both real sides.

### The AI

Every unit sheet has an **AI Controlled** checkbox — checked, the AI plays that unit's turns: attack the best target in range (cover-aware, prefers low HP and finishers), advance toward the nearest spotted enemy, flee when badly wounded, hold on overwatch when nothing is spotted. It works for friendly units too, so AI squadmates are one checkbox away, and it overrides the global setting. While an AI unit acts, the interface steps aside: the command ring hides, the status card reads **"AI is acting — spectating…"**, and the hotkeys can't be fired into its turn.

### Overwatch

1 AP puts a unit on overwatch covering a **90° cone** out to weapon range — a blue cone preview sweeps with the mouse, click to lock the facing. Any enemy that *steps into* the cone with line of sight takes a reaction shot at a −20 penalty. Moves are checked tile by tile, so an enemy passing *through* the cone gets shot even if it never stops inside it. The cone stays visible while the unit is selected.

### And the rest

- **Side-based turns** — friendly units act first, then hostiles, then neutrals last; initiative is assigned automatically from the unit's side.
- **Action Points** — every unit gets 2 AP per turn (per-sheet configurable); hitting 0 AP auto-ends the turn.
- **AI Controlled** — see above: per-unit checkbox, any side, spectator UI while it acts.
- **Original art** — the system ships with hand-drawn top-down tokens and props: troopers, raiders, heroes, crates, sandbags, fuel and water barrels, shipping containers — all in one shaded style, no third-party assets.
- **Test fight** — a settings-menu button that builds a dedicated arena and starts a fresh 2v2 in one click, for a quick smoke test after every tweak.
- **Downed units** — at 0 HP a unit gets a skull overlay, is marked defeated in the tracker and skipped. Healing clears it.
- **End of fight** — when one side runs out of living units the encounter ends itself with a victory/defeat/stalemate announcement.
- **Battle mode** — the eye button (bottom-left, `B` hotkey) hides Foundry's interface: tools, players list, navigation, hotbar, sidebar. Just the map and the COM HUDs. Remembered per client.
- **Token status** — an HP bar with AP pips under every unit, and a subtle stationary green frame on the active unit instead of Foundry's rotating marker.
- **Turn order HUD** — draggable, resizable, hideable (a small pill brings it back); position remembered per client.

## Playing

1. **Scene** — use a **square grid** (hex grids are not supported yet). Draw walls as usual; give the ones you want fighting over a Cover Height, or drop cover props from the box button (bottom-left).
2. **Units** — create `unit` actors and pick their side on the sheet: **Friendly**, **Neutral** (a bystander — no AI, no overwatch reactions, no victory weight) or **Enemy**. The setting propagates to every placed token of that unit. Then decide per unit whether the **AI Controlled** checkbox plays its turns.
3. **Weapons** — add `weapon` items on the unit sheet (damage formula, range in grid cells, equipped state), or drag them from the **COM Arsenal** compendium (assault rifles, sidearms, shotguns, sniper rifles, melee, explosives — the first dropped weapon is auto-equipped). Without a weapon a unit falls back to 1-damage unarmed strikes.
4. **Combat** — add tokens to the combat tracker and start. Turns are grouped friendly units, then hostiles, then neutrals automatically.

The **status card** (bottom center) shows the selected unit out of combat and hosts the action buttons for freeform play; in combat the actions live on the **command ring** around the active unit.

### Numbers (defaults)

- HP 10, AP 2, Aim 60, Defense 10, Speed 5 (cells per AP)
- Weapon: 1d6+1 damage, range 10 cells
- Hit chance clamp: 5–95 %, overwatch penalty: −20, overwatch cone: 90°
- Cover penalties: Half −20, Three-Quarter −30, Full −40 (per wall)
- Explosive barrel: 3d6 blast damage, 2-cell radius; +20 % to hit any prop (they don't dodge)
- All tunable in [`module/config.mjs`](module/config.mjs).

## Installing

**In Foundry:** Administration → Install System → Manifest URL:

```
https://raw.githubusercontent.com/XinSysVTT/COM/main/system.json
```

Requires Foundry Virtual Tabletop v13 or newer (verified on v14).

## How it fits together

| Folder | What lives there |
|---|---|
| `module/` | One ES module per concern: `tactics.mjs` (wiring), `models.mjs` (unit/weapon data models), `combat.mjs` (turns), `actions.mjs` (attacks, AP, overwatch triggers), `movement.mjs` (range + walking), `targeting.mjs` (click-to-target + forecast), `overwatch.mjs`/`cone.mjs` (reaction fire geometry), `cover.mjs` (wall + prop cover), `props.mjs`/`fx.mjs` (cover props, shooting props, explosions and tracer effects), `ai.mjs` (AI turns), `token-actions.mjs` (command ring), `token-overlay.mjs` (under-token bars), `hud.mjs`/`turn-order.mjs` (the DOM HUDs), `icons.mjs` (uniform SVG icon set), `arsenal.mjs` (weapon compendium helpers), `test-fight.mjs` (one-click arena), `sheets/` (unit & weapon sheets). |
| `templates/` | Handlebars templates for the HUDs and chat cards. |
| `styles/` | One stylesheet for the whole tactical UI. |
| `packs/` | The COM Arsenal weapon compendium. |

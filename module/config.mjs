/**
 * Tunable constants for the COM system.
 * All AP costs, hit-chance bounds and delays live here.
 */
export const SQ = {
  id: "com",

  // Action costs
  MOVE_AP: 1,
  ATTACK_AP: 1,
  OVERWATCH_AP: 1,

  // Overwatch reaction shots suffer this penalty to hit chance.
  OVERWATCH_PENALTY: 20,

  // Overwatch cone: full opening angle in degrees. The cone extends from the
  // unit out to its equipped weapon's range; walls block it like any shot.
  OVERWATCH_CONE_ANGLE: 90,

  // Highlight color for the overwatch cone (preview + active coverage).
  COLOR_OVERWATCH: 0x4da3ff,

  // Highlight layer names for the active cone and the facing preview.
  CONE_HIGHLIGHT_NAME: "com-overwatch-cone",
  CONE_PREVIEW_NAME: "com-overwatch-preview",

  // Hit chance is clamped to this window (%).
  MIN_HIT: 5,
  MAX_HIT: 95,

  // Wall cover: hit penalty (percent) for shooting at a unit hugging a
  // wall flagged as half / three-quarter / full cover (0 = none).
  COVER_BONUS: { 1: 20, 2: 30, 3: 40 },

  // How close (in grid cells) a cover wall must hug the defender's center
  // to protect them — only walls the unit stands against count.
  COVER_HUG_RADIUS: 0.75,

  // Tracer bolt colors: bright core over a warm glow.
  FX_TRACER: 0xffffff,
  FX_TRACER_GLOW: 0xff8820,

  // Movement pacing: delay between tiles when animating click-to-move.
  MOVE_STEP_MS: 45,

  // Delay before the tracker auto-advances once a unit runs out of AP.
  AUTO_END_DELAY_MS: 800,

  // Highlight colors for reachable tiles (1 AP = green, 2 AP dash = amber).
  COLOR_MOVE: 0x55ff55,
  COLOR_DASH: 0xffc04d,

  // Token overlay effect icons (drawn via overlay ActiveEffects).
  OVERWATCH_ICON: `systems/com/assets/overwatch.svg`,
  DOWNED_ICON: "icons/svg/skull.svg",
  OVERWATCH_EFFECT: "Overwatch",
  DOWNED_EFFECT: "Downed",

  // Name of the canvas highlight layer used for the movement range.
  HIGHLIGHT_NAME: "com-move-range",

  // Cover props: bonus to hit a stationary prop with a shot (props don't
  // dodge — only the shooter's aim decides, plus this bonus).
  PROP_HIT_BONUS: 20,

  // Explosive barrels: blast radius in grid cells (any footprint cell within
  // this range of the barrel is caught) and the damage roll dealt to every
  // victim in the blast.
  BARREL_BLAST_RADIUS: 2,
  BARREL_BLAST_DAMAGE: "3d6"
};

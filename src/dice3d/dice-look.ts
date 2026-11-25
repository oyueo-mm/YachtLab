/** Dice look types (no DOM / three.js: also used by the server-side catalog). */
export type DiceFinish = "matte" | "satin" | "gloss" | "metal" | "glass";
export type DicePattern = "none" | "pastel" | "marble" | "wood" | "stars" | "aurora" | "lava" | "ice" | "holo" | "neon" | "gem" | "carbon" | "brushed" | "dots";
/** Lv.2/Lv.3 motion of an upgraded dice theme (the 3D table animates it while visible). */
export type DiceAnim = "pulse" | "shimmer" | "sparkle";
export type DiceTrail = "lava" | "ice" | "electric" | "stars" | "gold" | "ghost" | "crystal" | "leaves" | "rainbow";
export type DiceLook = {
  face: string;
  pip: string;
  edge: string;
  finish?: DiceFinish;
  pattern?: DicePattern;
  /** Second colour of the pattern (veins, grain, stars…). */
  accent?: string;
  /** Emissive colour (glow) — pips / pattern light up. */
  glow?: string;
  anim?: DiceAnim;
  trail?: DiceTrail;
  landing?: boolean;
};


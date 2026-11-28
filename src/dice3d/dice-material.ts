/**
 * Physical material of a die (FX-1, 2026-11-28). One table, read by the 3D renderer (PBR parameters,
 * surface detail, motion response) and by the sound engine (base collision voice). Pure data: no DOM,
 * no three.js, so tests and the server-side catalog can import it.
 *
 * The material is derived from the item's existing look (pattern, finish, id) — no catalog field is
 * added or changed. Lv.1 = the material itself; Lv.2 adds a motion response (the die's own light reacts
 * to its speed and to hits, then fades); Lv.3 effects stay in dice-fx.ts. Nothing here touches physics,
 * values or results.
 */
import type { DiceLook } from "./dice-look";

export type MaterialClass = "plastic" | "resin" | "wood" | "metal" | "glass" | "gem" | "stone" | "ice" | "lava" | "composite" | "porcelain";
/** Procedural relief / roughness detail painted into the surface maps. */
export type SurfaceDetail = "none" | "grain" | "brushed" | "veins" | "frost" | "weave" | "facets" | "crackle" | "fibers";
/**
 * How a die's own light answers motion (Lv.2+, only on dice that glow):
 *  - charge: electric — flickers up with speed, crackles on hits (번개)
 *  - heat:   hits pour heat in, it cools slowly (용암)
 *  - shimmer: a soft swell that follows speed (보석·유리·오로라·우주·홀로그램)
 *  - pulse:  hits ring the light like a bell (네온·금속)
 */
export type MotionResponse = "none" | "charge" | "heat" | "shimmer" | "pulse";
/** Base collision voice (sound-packs `dieSounds` keys plus plastic). */
export type SoundMaterial = "plastic" | "resin" | "wood" | "metal" | "gold" | "glass" | "crystal" | "stone" | "ice" | "lava" | "magic" | "space";

export type DiceMaterialSpec = {
  class: MaterialClass;
  roughness: number;
  metalness: number;
  /** Lacquer / polish layer (MeshPhysicalMaterial, high quality only). */
  clearcoat: number;
  clearcoatRoughness: number;
  /** Strength of studio reflections (0 = none: the environment map is not even built). */
  env: number;
  /** Thin-film colour shift (holographic, aurora). */
  iridescence: number;
  /** Soft fuzz at grazing angles (velvety grass, porcelain bloom). */
  sheen: number;
  sheenColor?: string;
  /** < 1: see-through body (glass, ice, gems). Pips stay opaque-looking because they are dark. */
  opacity: number;
  detail: SurfaceDetail;
  /** Relief strength of the detail (bump map units). */
  relief: number;
  /** Engraved pips: depth of the pip dimples in the bump map (0 = printed). */
  pipDepth: number;
  /** Pattern parts that glow by themselves even at Lv.1 (lava cracks, lightning) — mask in face-paint. */
  selfGlow: number;
  motion: MotionResponse;
  sound: SoundMaterial;
};

const base: DiceMaterialSpec = {
  class: "plastic", roughness: 0.62, metalness: 0, clearcoat: 0, clearcoatRoughness: 0.3, env: 0, iridescence: 0, sheen: 0,
  opacity: 1, detail: "none", relief: 0, pipDepth: 0.55, selfGlow: 0, motion: "none", sound: "plastic",
};
const spec = (o: Partial<DiceMaterialSpec>): DiceMaterialSpec => ({ ...base, ...o });

/** Item-specific materials where the pattern alone is not enough. */
const BY_ID: Record<string, Partial<DiceMaterialSpec>> = {
  "dice.gold": { class: "metal", roughness: 0.24, metalness: 1, env: 1.25, detail: "brushed", relief: 0.25, pipDepth: 0.8, motion: "pulse", sound: "gold" },
  "dice.christmas": { class: "gem", roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.04, env: 1.2, opacity: 0.97, detail: "facets", relief: 0.2, motion: "shimmer", sound: "crystal" },
  "dice.royal": { class: "resin", roughness: 0.28, clearcoat: 0.8, clearcoatRoughness: 0.1, env: 0.55, sound: "resin" },
  "dice.ink": { class: "plastic", roughness: 0.78 },
};

/** The die's material, from its look (and id for a few named items). */
export function diceMaterialSpec(look: DiceLook | null | undefined, itemId?: string | null): DiceMaterialSpec {
  const named = itemId ? BY_ID[itemId] : undefined;
  const finish = look?.finish;
  let s: DiceMaterialSpec;
  switch (look?.pattern) {
    case "wood":
      s = spec({ class: "wood", roughness: 0.6, clearcoat: 0.35, clearcoatRoughness: 0.45, env: 0.3, detail: "grain", relief: 0.55, pipDepth: 0.85, sound: "wood" });
      break;
    case "marble":
      s = spec({ class: "stone", roughness: 0.16, clearcoat: 0.7, clearcoatRoughness: 0.06, env: 0.75, detail: "veins", relief: 0.12, pipDepth: 0.85, sound: "stone" });
      break;
    case "ice":
      s = spec({ class: "ice", roughness: 0.3, clearcoat: 0.9, clearcoatRoughness: 0.2, env: 1, opacity: 0.9, detail: "frost", relief: 0.35, pipDepth: 0.6, sound: "ice" });
      break;
    case "carbon":
      s = spec({ class: "composite", roughness: 0.42, clearcoat: 1, clearcoatRoughness: 0.06, env: 0.7, detail: "weave", relief: 0.4, sound: "metal" });
      break;
    case "brushed":
      s = spec({ class: "metal", roughness: 0.3, metalness: 1, env: 1.2, detail: "brushed", relief: 0.2, pipDepth: 0.8, motion: "pulse", sound: "metal" });
      break;
    case "gem":
      s = spec({ class: "gem", roughness: 0.06, clearcoat: 1, clearcoatRoughness: 0.03, env: 1.35, opacity: 0.95, detail: "facets", relief: 0.22, pipDepth: 0.5, motion: "shimmer", sound: "crystal" });
      break;
    case "lava":
      s = spec({ class: "lava", roughness: 0.86, env: 0.15, detail: "crackle", relief: 0.75, pipDepth: 0.7, selfGlow: 0.7, motion: "heat", sound: "lava" });
      break;
    case "lightning":
      s = spec({ class: "resin", roughness: 0.34, clearcoat: 0.8, clearcoatRoughness: 0.12, env: 0.55, selfGlow: 0.35, motion: "charge", sound: "resin" });
      break;
    case "aurora":
      s = spec({ class: "resin", roughness: 0.4, clearcoat: 0.7, clearcoatRoughness: 0.15, env: 0.55, iridescence: 0.45, motion: "shimmer", sound: "magic" });
      break;
    case "holo":
      s = spec({ class: "resin", roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.05, env: 1, iridescence: 1, motion: "shimmer", sound: "magic" });
      break;
    case "stars":
      s = spec({ class: "resin", roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.04, env: 0.7, iridescence: 0.15, motion: "shimmer", sound: "space" });
      break;
    case "neon":
      s = spec({ class: "plastic", roughness: 0.52, clearcoat: 0.4, clearcoatRoughness: 0.35, env: 0.25, motion: "pulse", sound: "space" });
      break;
    case "abyss":
      s = spec({ class: "resin", roughness: 0.14, clearcoat: 1, clearcoatRoughness: 0.05, env: 0.85, selfGlow: 0.25, motion: "shimmer", sound: "resin" });
      break;
    case "grass":
      s = spec({ class: "plastic", roughness: 0.82, sheen: 0.8, sheenColor: look?.accent ?? "#5f9a36", detail: "fibers", relief: 0.3, sound: "plastic" });
      break;
    case "petals":
      s = spec({ class: "porcelain", roughness: 0.38, clearcoat: 0.5, clearcoatRoughness: 0.2, env: 0.35, sheen: 0.3, sheenColor: "#ffd1e0", sound: "resin" });
      break;
    case "sakura":
      s = spec({ class: "porcelain", roughness: 0.34, clearcoat: 0.6, clearcoatRoughness: 0.18, env: 0.4, sheen: 0.45, sheenColor: "#ffc2d4", sound: "resin" });
      break;
    default:
      if (finish === "glass") s = spec({ class: "glass", roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.02, env: 1.3, opacity: 0.8, pipDepth: 0.4, motion: "shimmer", sound: "glass" });
      else if (finish === "metal") s = spec({ class: "metal", roughness: 0.3, metalness: 1, env: 1.2, pipDepth: 0.8, motion: "pulse", sound: "metal" });
      else if (finish === "gloss") s = spec({ class: "resin", roughness: 0.22, clearcoat: 0.9, clearcoatRoughness: 0.08, env: 0.6, sound: "resin" });
      else if (finish === "satin") s = spec({ class: "plastic", roughness: 0.42, clearcoat: 0.3, clearcoatRoughness: 0.3, env: 0.3 });
      else s = spec({});
  }
  // A finish written on a patterned item still matters (e.g. a gloss marble is polished).
  if (look?.pattern && finish === "matte") s = { ...s, roughness: Math.max(s.roughness, 0.7), clearcoat: 0, env: Math.min(s.env, 0.2) };
  return named ? { ...s, ...named } : s;
}

/** Simplified spec for the "성능 우선" quality / slow devices: no physical layers, same identity. */
export function liteSpec(s: DiceMaterialSpec): DiceMaterialSpec {
  return { ...s, clearcoat: 0, iridescence: 0, sheen: 0, env: Math.min(s.env, 0.9), roughness: s.clearcoat ? Math.max(0.12, s.roughness * 0.85) : s.roughness };
}

/**
 * Motion response energy (Lv.2+). `energy` is 0..1: speed and hits pour in, it decays with a time
 * constant per response kind — start, swell, linger, fade, never an abrupt cut. Returns the emissive
 * multiplier (≥ 1) for the die's glow. `t` (seconds) gives the flicker of a charged die.
 */
export const MOTION_DECAY_S: Record<MotionResponse, number> = { none: 0.1, charge: 0.35, heat: 1.6, shimmer: 0.6, pulse: 0.45 };
export function stepEnergy(kind: MotionResponse, energy: number, dt: number, speed: number, hit: number): number {
  if (kind === "none") return 0;
  const target = Math.min(1, speed / 9);
  const gain = kind === "heat" ? 0.25 : kind === "charge" ? 1.2 : 0.8;
  let e = energy + (target - energy) * Math.min(1, dt * 6) * gain * (target > energy ? 1 : 0);
  e += Math.min(1, hit / 10) * (kind === "heat" ? 0.35 : kind === "pulse" ? 0.6 : kind === "charge" ? 0.5 : 0.2);
  e *= Math.exp(-dt / MOTION_DECAY_S[kind]);
  return Math.max(0, Math.min(1, e));
}
export function motionGlow(kind: MotionResponse, energy: number, t: number): number {
  if (kind === "none" || energy <= 0.001) return 1;
  if (kind === "charge") return 1 + energy * (1.4 + 1.2 * Math.abs(Math.sin(t * 47) * Math.sin(t * 13.7)));
  if (kind === "heat") return 1 + energy * (1.6 + 0.25 * Math.sin(t * 5.3));
  if (kind === "pulse") return 1 + energy * 1.5;
  return 1 + energy * 0.9;
}

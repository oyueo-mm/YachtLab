import type { DiceLook } from "./economy/live/catalog";
import { diceMaterialSpec } from "./dice3d/dice-material";

/**
 * Base collision voices per die material (modal frequency, decay, body thump, texture band, overtone
 * ratios). The physical sound layer: theme accents (dice-fx `sound`) are a separate, quieter layer.
 */
export const dieSounds = {
  wood: { frequency: 680, decay: .010, body: 165, texture: 1150, overtones: [1, 1.54] },
  metal: { frequency: 1830, decay: .043, body: 125, texture: 3050, overtones: [1, 1.43, 2.07] },
  gold: { frequency: 1318, decay: .065, body: 150, texture: 2550, overtones: [1, 1.50, 2.23] },
  glass: { frequency: 2580, decay: .041, body: 270, texture: 5800, overtones: [1, 1.85, 2.33] },
  crystal: { frequency: 1975, decay: .070, body: 320, texture: 4300, overtones: [1, 1.50, 2.51] },
  stone: { frequency: 465, decay: .014, body: 95, texture: 1500, overtones: [1, 2.36] },
  ice: { frequency: 2220, decay: .038, body: 205, texture: 7600, overtones: [1, 1.61, 2.41] },
  lava: { frequency: 350, decay: .031, body: 68, texture: 830, overtones: [1, 1.94, 3.05] },
  magic: { frequency: 1480, decay: .050, body: 277, texture: 4600, overtones: [1, 1.50, 2.0] },
  space: { frequency: 1047, decay: .043, body: 175, texture: 3800, overtones: [1, 1.25, 2.0] },
  /** FX-1: cast resin / lacquered (gloss and porcelain-like dice): denser and a little longer than plastic. */
  resin: { frequency: 1240, decay: .022, body: 190, texture: 2700, overtones: [1, 1.72, 2.6] },
};

export type DiceMaterial = "plastic" | keyof typeof dieSounds;

/**
 * Die material for sound. Since FX-1 this is the same table the 3D renderer uses (dice-material.ts),
 * so a die sounds like what it looks like. Mappings that existed before are unchanged (wood, marble →
 * stone, ice, carbon / brushed → metal, gems → crystal, lava, aurora / holo → magic, stars / neon →
 * space, gold, glass, metal); dice that used to fall back to plastic (gloss, lightning, abyss, petals,
 * sakura, royal) now get the resin voice.
 */
export function diceMaterial(itemId?: string, look?: DiceLook | null): DiceMaterial {
  return diceMaterialSpec(look ?? null, itemId).sound;
}

export type EmoteSound = "clap" | "party" | "fire" | "bolt" | "gem" | "rattle" | "rocket" | "chime" | "wave" | "pop" | "sigh";
const emoteSounds: Record<string, EmoteSound> = {
  clap: "clap", handshake: "clap", party: "party", yay: "party", hundred: "party", trophy: "party",
  fire: "fire", fired_up: "fire", bolt: "bolt",
  gem: "gem", sparkles: "gem", starlight: "gem", crown: "gem",
  dice: "rattle", target: "rattle", rocket: "rocket", whale: "wave",
  rainbow: "chime", clover: "chime", cake: "chime", thumbs_up: "chime",
  sleepy: "sigh", cry: "sigh", sweat: "sigh", think: "sigh", please: "sigh",
};

export const emoteSound = (id: string): EmoteSound => emoteSounds[id.slice("emote.".length)] ?? "pop";

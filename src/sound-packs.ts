import type { DiceLook } from "./economy/live/catalog";

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
};

export type DiceMaterial = "plastic" | keyof typeof dieSounds;

export function diceMaterial(itemId?: string, look?: DiceLook | null): DiceMaterial {
  if (itemId === "dice.gold") return "gold";
  switch (look?.pattern) {
    case "wood": return "wood";
    case "marble": return "stone";
    case "ice": return "ice";
    case "carbon":
    case "brushed": return "metal";
    case "gem": return "crystal";
    case "lava": return "lava";
    case "aurora":
    case "holo": return "magic";
    case "stars":
    case "neon": return "space";
    default: return look?.finish === "glass" ? "glass" : look?.finish === "metal" ? "metal" : "plastic";
  }
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

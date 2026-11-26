/**
 * Dice upgrade effects (2026-11-26): one hand-designed profile per dice item. Data only (no DOM), also
 * read by the catalog (level descriptions) on the server.
 *
 *  Lv.1  the die itself (face paint, finish, material sound) — unchanged.
 *  Lv.2  a unique effect while the dice roll and slide to the hold shelf (`trail`, `streak`).
 *  Lv.3  Lv.2 plus collisions (`impact`) and the landing (`land`: shockwaves, bursts, cracks, arcs,
 *        rays) and a short themed landing accent sound.
 *
 * Effects are drawn on a 2D overlay above the 3D table with `pointer-events: none`: they never touch
 * the die body colour, the pips, physics or results. Particle counts are scaled by the effect budget
 * (settings → 효과 품질, low-end devices, reduced motion = none).
 */
export type FxShape =
  | "dot" | "glow" | "spark" | "ember" | "flame" | "smoke" | "crystal" | "snow" | "star" | "petal" | "leaf"
  | "heart" | "bubble" | "flake" | "shard" | "prism" | "chip" | "flower" | "glitch" | "drop" | "note" | "cloud";
export type Emitter = {
  shape: FxShape;
  colors: string[];
  /** Particles per emission (scaled by the effect budget). */
  n: number;
  speed: [number, number];
  life: [number, number];
  size: [number, number];
  /** px/s² downwards (negative rises). */
  gravity?: number;
  /** 0..1 velocity kept per second. */
  drag?: number;
  spin?: number;
  /** Additive blending (light). */
  glow?: boolean;
  /** Hue drift (holographic / aurora). */
  hue?: boolean;
  /** Size multiplier reached at the end of life. */
  grow?: number;
  alpha?: number;
};
export type Ring = { color: string; width: number; radius: number; life: number; delay?: number; square?: boolean; dashed?: boolean; glow?: boolean; fill?: string };
export type Lines = { kind: "crack" | "arc" | "ray"; color: string; n: number; length: number; life: number; width?: number; glow?: boolean };
export type Streak = { colors: string[]; width: number; life: number; glow?: boolean; hue?: boolean };
export type LandSound = "fizz" | "pop" | "chime" | "ice" | "thud" | "spark" | "zap" | "fire" | "coin" | "whoosh" | "bell" | "glass" | "cosmic" | "crack";
export type DiceFxProfile = {
  lv2: string;
  lv3: string;
  /** Emitted along each moving die (~26 per second). */
  trail: Emitter[];
  /** A continuous ribbon behind each die (light trail). */
  streak?: Streak;
  /** Strong collisions (Lv.3). */
  impact: { burst: Emitter[]; ring?: Ring[]; lines?: Lines[] };
  /** When the dice come to rest (Lv.3). */
  land: { burst: Emitter[]; ring?: Ring[]; lines?: Lines[] };
  sound: LandSound;
};

const e = (shape: FxShape, colors: string[], n: number, o: Partial<Emitter> = {}): Emitter => ({
  shape, colors, n, speed: [10, 30], life: [0.3, 0.55], size: [2.5, 5], ...o,
});
const ring = (color: string, radius: number, o: Partial<Ring> = {}): Ring => ({ color, radius, width: 2, life: 0.55, ...o });

export const DICE_FX: Record<string, DiceFxProfile> = {
  "dice.mint": {
    lv2: "민트 거품이 피어올라요", lv3: "착지하면 거품이 톡 터져요",
    trail: [e("bubble", ["#c9f4e3", "#9de0c6", "#ffffff"], 1, { gravity: -60, speed: [4, 14], life: [0.5, 0.8], size: [2.5, 5] })],
    impact: { burst: [e("bubble", ["#b8efd9", "#ffffff"], 4, { speed: [30, 60], gravity: -40, size: [2, 4] })] },
    land: { burst: [e("bubble", ["#c9f4e3", "#9de0c6", "#ffffff"], 10, { speed: [40, 90], gravity: -50, life: [0.5, 0.9], size: [2.5, 6] })], ring: [ring("#a9e8cf", 26, { width: 1.5 })] },
    sound: "pop",
  },
  "dice.ink": {
    lv2: "먹물 연기가 번져요", lv3: "착지하면 먹물이 튀어요",
    trail: [e("smoke", ["#2b2b2e", "#3a3a40"], 1, { speed: [2, 8], life: [0.5, 0.8], size: [5, 8], grow: 2.2, alpha: 0.35 })],
    impact: { burst: [e("drop", ["#1c1c1f", "#3a3a40"], 4, { speed: [50, 90], gravity: 220, size: [2, 3.5] })] },
    land: { burst: [e("drop", ["#18181b", "#2f2f35"], 9, { speed: [60, 130], gravity: 260, life: [0.4, 0.6], size: [2, 4.5] })], ring: [ring("rgba(30,30,34,0.55)", 22, { width: 5, life: 0.7, fill: "rgba(30,30,34,0.18)" })] },
    sound: "thud",
  },
  "dice.sunset": {
    lv2: "노을빛 잔광이 남아요", lv3: "착지하면 햇살이 퍼져요",
    trail: [e("glow", ["#ffb27a", "#ff8a8a", "#ffd59e"], 1, { speed: [2, 8], life: [0.35, 0.5], size: [4, 7], glow: true, alpha: 0.55 })],
    streak: { colors: ["#ffb27a", "#ff7f7f"], width: 5, life: 0.28, glow: true },
    impact: { burst: [e("dot", ["#ffd59e", "#ffb27a"], 4, { speed: [40, 70], glow: true })] },
    land: { burst: [e("dot", ["#ffd59e", "#ffc38a"], 6, { speed: [30, 60], glow: true })], lines: [{ kind: "ray", color: "#ffc38a", n: 10, length: 34, life: 0.6, width: 2, glow: true }] },
    sound: "chime",
  },
  "dice.royal": {
    lv2: "금사 같은 빛줄기가 따라와요", lv3: "착지하면 왕실 문장 빛이 울려요",
    trail: [e("star", ["#f3d36b", "#ffe9a8"], 1, { speed: [4, 12], life: [0.35, 0.55], size: [3, 5], glow: true })],
    streak: { colors: ["#f3d36b", "#c9a43c"], width: 2.5, life: 0.3, glow: true },
    impact: { burst: [e("star", ["#f3d36b", "#ffffff"], 4, { speed: [40, 80], glow: true, size: [3, 5] })] },
    land: { burst: [e("star", ["#f3d36b", "#ffe9a8", "#ffffff"], 8, { speed: [40, 90], glow: true, size: [3, 6], life: [0.5, 0.7] })], ring: [ring("#f3d36b", 24, { glow: true }), ring("#7d8fe0", 34, { delay: 0.08, width: 1.5 })] },
    sound: "bell",
  },
  "dice.christmas": {
    lv2: "금빛 눈 결정이 흩날려요", lv3: "착지하면 결정이 퍼지고 방울이 울려요",
    trail: [e("snow", ["#ffe6a0", "#ffffff", "#8fd3a7"], 1, { speed: [5, 14], life: [0.5, 0.8], size: [3, 5], gravity: 25, spin: 2 })],
    impact: { burst: [e("snow", ["#ffe6a0", "#ffffff"], 4, { speed: [40, 70], spin: 3 })] },
    land: { burst: [e("snow", ["#ffe6a0", "#ffffff", "#e05a74"], 10, { speed: [40, 90], spin: 3, life: [0.6, 0.9], size: [3, 6] })], ring: [ring("#ffd56b", 26, { glow: true })] },
    sound: "bell",
  },
  "dice.pastel_pink": {
    lv2: "작은 하트가 퐁퐁 떠올라요", lv3: "착지하면 하트가 활짝 터져요",
    trail: [e("heart", ["#ff9fbd", "#ffc6d8"], 1, { gravity: -45, speed: [4, 12], life: [0.5, 0.75], size: [3, 5] })],
    impact: { burst: [e("heart", ["#ff9fbd", "#ffffff"], 3, { speed: [30, 60], gravity: -30 })] },
    land: { burst: [e("heart", ["#ff8fb3", "#ffc6d8", "#ffffff"], 9, { speed: [40, 85], gravity: -30, size: [3, 6], life: [0.6, 0.9] })], ring: [ring("#ffb5cc", 24, { width: 2.5 })] },
    sound: "pop",
  },
  "dice.pastel_sky": {
    lv2: "구름 조각이 뭉게뭉게 따라와요", lv3: "착지하면 구름이 퍼지고 반짝여요",
    trail: [e("cloud", ["#ffffff", "#e3f1ff"], 1, { speed: [2, 6], life: [0.5, 0.75], size: [4, 7], grow: 1.6, alpha: 0.7 })],
    impact: { burst: [e("star", ["#ffffff", "#bfe0ff"], 3, { speed: [30, 60], glow: true, size: [2, 4] })] },
    land: { burst: [e("cloud", ["#ffffff", "#e3f1ff"], 7, { speed: [30, 60], life: [0.6, 0.9], size: [5, 9], grow: 1.8, alpha: 0.8 }), e("star", ["#ffffff"], 4, { speed: [40, 80], glow: true, size: [2, 4] })] },
    sound: "whoosh",
  },
  "dice.pastel_lemon": {
    lv2: "레몬 탄산 방울이 올라와요", lv3: "착지하면 탄산이 시원하게 터져요",
    trail: [e("bubble", ["#fff3a8", "#ffffff"], 2, { gravity: -110, speed: [6, 16], life: [0.3, 0.5], size: [1.2, 2.6] })],
    impact: { burst: [e("bubble", ["#fff3a8", "#ffffff"], 6, { speed: [40, 80], gravity: -80, size: [1, 2.5] })] },
    land: { burst: [e("bubble", ["#fff3a8", "#ffe46b", "#ffffff"], 16, { speed: [40, 110], gravity: -120, life: [0.4, 0.7], size: [1.2, 3] })], ring: [ring("#ffe46b", 22, { dashed: true, width: 2.5 })] },
    sound: "fizz",
  },
  "dice.pastel_lavender": {
    lv2: "라벤더 꽃잎이 흩날려요", lv3: "착지하면 꽃잎이 소용돌이쳐요",
    trail: [e("petal", ["#cdb8f2", "#e8dcff", "#a98be0"], 1, { gravity: 30, speed: [6, 16], life: [0.6, 0.9], size: [3, 5], spin: 4 })],
    impact: { burst: [e("petal", ["#cdb8f2", "#e8dcff"], 3, { speed: [30, 60], spin: 5 })] },
    land: { burst: [e("petal", ["#cdb8f2", "#e8dcff", "#a98be0"], 10, { speed: [40, 80], spin: 6, life: [0.7, 1], size: [3, 6], drag: 0.4 })], ring: [ring("#c9b2f0", 28, { dashed: true, width: 1.5, life: 0.8 })] },
    sound: "chime",
  },
  "dice.pastel_peach": {
    lv2: "복숭아빛 솜털 가루가 날려요", lv3: "착지하면 복숭아꽃이 피어요",
    trail: [e("glow", ["#ffd8bd", "#ffc2a3"], 1, { speed: [3, 10], life: [0.5, 0.8], size: [2, 4], alpha: 0.7 })],
    impact: { burst: [e("glow", ["#ffd8bd", "#ffffff"], 4, { speed: [30, 60], size: [2, 3] })] },
    land: { burst: [e("flower", ["#ffb3a0", "#ffd2c0"], 4, { speed: [20, 50], life: [0.7, 1], size: [5, 8], spin: 1.5 }), e("glow", ["#ffe1cf"], 6, { speed: [30, 70], size: [2, 3] })] },
    sound: "chime",
  },
  "dice.wood_oak": {
    lv2: "초록 나뭇잎이 흩날려요", lv3: "착지하면 잎사귀와 나무 조각이 튀어요",
    trail: [e("leaf", ["#a9dd67", "#74b866", "#def3b1"], 1, { gravity: 35, speed: [6, 16], life: [0.6, 0.9], size: [3, 5], spin: 4 })],
    impact: { burst: [e("chip", ["#a77b44", "#d9b27c"], 4, { speed: [40, 80], gravity: 200, spin: 8 })] },
    land: { burst: [e("leaf", ["#a9dd67", "#74b866"], 7, { speed: [40, 80], spin: 6, life: [0.7, 1], gravity: 40 }), e("chip", ["#a77b44", "#d9b27c"], 5, { speed: [50, 100], gravity: 260, spin: 10 })] },
    sound: "thud",
  },
  "dice.wood_walnut": {
    lv2: "고운 톱밥이 흘러내려요", lv3: "착지하면 묵직한 먼지와 나무 조각이 일어요",
    trail: [e("dot", ["#7b5233", "#a77b54", "#c79a6c"], 2, { gravity: 120, speed: [4, 12], life: [0.35, 0.55], size: [1, 2] })],
    impact: { burst: [e("chip", ["#4c2f1a", "#7b5233"], 4, { speed: [40, 80], gravity: 220, spin: 8 })] },
    land: { burst: [e("smoke", ["#b79576", "#9b7a5c"], 5, { speed: [20, 40], life: [0.6, 0.9], size: [5, 8], grow: 2, alpha: 0.35 }), e("chip", ["#4c2f1a", "#7b5233"], 6, { speed: [50, 100], gravity: 260, spin: 10 })] },
    sound: "thud",
  },
  "dice.marble_white": {
    lv2: "고운 대리석 가루가 남아요", lv3: "착지하면 바닥에 금이 가고 돌 조각이 튀어요",
    trail: [e("dot", ["#ffffff", "#d9d9d6"], 1, { speed: [3, 10], life: [0.4, 0.6], size: [1.5, 2.5], alpha: 0.8 })],
    impact: { burst: [e("chip", ["#e9e9e6", "#bdbdb8"], 4, { speed: [40, 80], gravity: 220, spin: 6 })] },
    land: { burst: [e("chip", ["#f4f4f2", "#bdbdb8", "#8f8f8f"], 7, { speed: [50, 100], gravity: 260, spin: 8 })], lines: [{ kind: "crack", color: "rgba(240,240,236,0.8)", n: 5, length: 30, life: 0.9, width: 1.3 }] },
    sound: "crack",
  },
  "dice.marble_black": {
    lv2: "흑요석 가루에 은빛이 섞여요", lv3: "착지하면 은빛 균열이 번져요",
    trail: [e("dot", ["#3a3a3d", "#c9c9c9"], 1, { speed: [3, 10], life: [0.4, 0.6], size: [1.5, 2.5] }), e("star", ["#e8e8e8"], 0.3, { speed: [2, 6], life: [0.25, 0.4], size: [2, 3], glow: true })],
    impact: { burst: [e("shard", ["#232325", "#c9c9c9"], 4, { speed: [40, 80], gravity: 200, spin: 6 })] },
    land: { burst: [e("shard", ["#232325", "#5a5a5e", "#c9c9c9"], 7, { speed: [50, 100], gravity: 240, spin: 8 })], lines: [{ kind: "crack", color: "#d6d6d6", n: 6, length: 32, life: 0.9, width: 1.2, glow: true }] },
    sound: "crack",
  },
  "dice.frost": {
    lv2: "서리 결정과 냉기가 피어나요", lv3: "착지하면 얼음 고리가 번지고 결정이 튀어요",
    trail: [e("crystal", ["#f7ffff", "#b2e8ff"], 1, { speed: [4, 12], life: [0.4, 0.6], size: [2.5, 4], spin: 2, glow: true }), e("smoke", ["#e6f7ff"], 0.5, { speed: [2, 6], life: [0.5, 0.8], size: [4, 6], grow: 2, alpha: 0.3 })],
    impact: { burst: [e("snow", ["#f7ffff", "#b2e8ff"], 4, { speed: [40, 70], spin: 3 })] },
    land: { burst: [e("shard", ["#e8f8ff", "#a9d3ec", "#ffffff"], 8, { speed: [50, 100], gravity: 120, spin: 6 })], ring: [ring("#bfe9ff", 26, { width: 3, glow: true, fill: "rgba(200,240,255,0.12)" })] },
    sound: "ice",
  },
  "dice.carbon": {
    lv2: "금속 마찰 불티가 튀어요", lv3: "착지하면 불티가 쏟아지고 육각 파동이 퍼져요",
    trail: [e("spark", ["#ffffff", "#ffd29a", "#9aa0a8"], 1, { speed: [40, 80], gravity: 260, life: [0.2, 0.35], size: [3, 6], glow: true })],
    impact: { burst: [e("spark", ["#ffffff", "#ffb35a"], 6, { speed: [80, 150], gravity: 300, life: [0.2, 0.35], size: [4, 7], glow: true })] },
    land: { burst: [e("spark", ["#ffffff", "#ffd29a", "#ff9d3b"], 10, { speed: [80, 170], gravity: 320, life: [0.25, 0.45], size: [4, 8], glow: true })], ring: [ring("#9aa0a8", 24, { square: true, width: 1.5 })] },
    sound: "spark",
  },
  "dice.ruby": {
    lv2: "붉은 빛이 굴절돼 반짝여요", lv3: "착지하면 루비 파편과 붉은 섬광이 터져요",
    trail: [e("prism", ["#ff6b81", "#ffd0d8", "#ff2e55"], 1, { speed: [4, 12], life: [0.3, 0.5], size: [3, 5], spin: 3, glow: true })],
    impact: { burst: [e("shard", ["#ff4d6d", "#ffd0d8"], 4, { speed: [40, 80], spin: 6, glow: true })] },
    land: { burst: [e("shard", ["#b3122e", "#ff6b81", "#ffd0d8"], 9, { speed: [50, 110], spin: 8, glow: true, life: [0.4, 0.65] })], ring: [ring("#ff5c7a", 24, { width: 2.5, glow: true })] },
    sound: "glass",
  },
  "dice.sapphire": {
    lv2: "푸른 물빛이 일렁여요", lv3: "착지하면 물결 두 겹이 퍼져요",
    trail: [e("drop", ["#7aa2ff", "#cfe0ff"], 1, { speed: [4, 12], life: [0.35, 0.55], size: [2, 3.5], glow: true })],
    impact: { burst: [e("prism", ["#7aa2ff", "#ffffff"], 4, { speed: [40, 80], spin: 5, glow: true })] },
    land: { burst: [e("drop", ["#7aa2ff", "#eef3ff"], 6, { speed: [40, 90], gravity: 160 })], ring: [ring("#7aa2ff", 22, { width: 2, glow: true }), ring("#b6caff", 32, { delay: 0.12, width: 1.5 })] },
    sound: "glass",
  },
  "dice.emerald": {
    lv2: "에메랄드 빛과 작은 잎이 어울려요", lv3: "착지하면 초록 파편과 육각 빛이 퍼져요",
    trail: [e("prism", ["#6fe3ad", "#c9ffe4"], 1, { speed: [4, 12], life: [0.3, 0.5], size: [3, 5], spin: 3, glow: true }), e("leaf", ["#3fbf7f"], 0.4, { speed: [6, 14], spin: 4, gravity: 30, life: [0.5, 0.7] })],
    impact: { burst: [e("shard", ["#0f7a4f", "#6fe3ad"], 4, { speed: [40, 80], spin: 6, glow: true })] },
    land: { burst: [e("shard", ["#0f7a4f", "#6fe3ad", "#eafff4"], 9, { speed: [50, 110], spin: 8, glow: true })], ring: [ring("#5fe3a4", 26, { square: true, width: 2, glow: true })] },
    sound: "glass",
  },
  "dice.glass_blue": {
    lv2: "투명한 잔상이 따라와요", lv3: "착지하면 유리 조각이 맑게 튀어요",
    trail: [e("glitch", ["rgba(159,208,255,0.55)", "rgba(220,238,255,0.5)"], 1, { speed: [1, 4], life: [0.25, 0.4], size: [9, 12], alpha: 0.45 })],
    impact: { burst: [e("shard", ["#cfe6ff", "#ffffff"], 4, { speed: [40, 80], spin: 6, glow: true })] },
    land: { burst: [e("shard", ["#cfe6ff", "#8fbfee", "#ffffff"], 9, { speed: [50, 110], spin: 8, gravity: 120, glow: true })], ring: [ring("#d9ecff", 22, { width: 1.5, glow: true })] },
    sound: "glass",
  },
  "dice.glass_amber": {
    lv2: "호박빛 잔상과 꿀방울이 남아요", lv3: "착지하면 호박색 방울이 튀어요",
    trail: [e("glitch", ["rgba(255,192,102,0.5)", "rgba(255,220,160,0.45)"], 1, { speed: [1, 4], life: [0.25, 0.4], size: [9, 12], alpha: 0.45 }), e("drop", ["#ffb347"], 0.4, { gravity: 140, speed: [4, 10] })],
    impact: { burst: [e("drop", ["#ffb347", "#ffe0a8"], 4, { speed: [40, 80], gravity: 200 })] },
    land: { burst: [e("drop", ["#e0a14e", "#ffc066", "#ffe0a8"], 9, { speed: [50, 110], gravity: 240 })], ring: [ring("#ffc066", 24, { width: 2.5, glow: true, fill: "rgba(255,190,90,0.12)" })] },
    sound: "glass",
  },
  "dice.silver": {
    lv2: "은빛 섬광이 반짝여요", lv3: "착지하면 은빛 충격파가 퍼져요",
    trail: [e("star", ["#ffffff", "#e8f0ff", "#b8c2cf"], 1, { speed: [3, 10], life: [0.25, 0.45], size: [3, 5], glow: true })],
    impact: { burst: [e("spark", ["#ffffff", "#dfe6ee"], 5, { speed: [70, 130], gravity: 200, size: [3, 6], glow: true })] },
    land: { burst: [e("star", ["#ffffff", "#e8f0ff"], 6, { speed: [40, 90], glow: true })], ring: [ring("#e8f0ff", 30, { width: 3, glow: true }), ring("#9aa1a9", 20, { delay: 0.06, width: 1.5 })] },
    sound: "coin",
  },
  "dice.bronze": {
    lv2: "청동 불꽃이 튀어요", lv3: "착지하면 대장간 불티가 쏟아져요",
    trail: [e("spark", ["#ffb46b", "#e3a86a", "#ffe0b8"], 1, { speed: [30, 60], gravity: 240, life: [0.2, 0.35], size: [3, 5], glow: true })],
    impact: { burst: [e("spark", ["#ffb46b", "#fff0d0"], 6, { speed: [80, 140], gravity: 300, size: [3, 6], glow: true })] },
    land: { burst: [e("ember", ["#ff9d3b", "#ffb46b", "#ffe0b8"], 10, { speed: [60, 140], gravity: 260, life: [0.3, 0.6], glow: true })], ring: [ring("#b5763c", 26, { width: 3 })] },
    sound: "spark",
  },
  "dice.aurora": {
    lv2: "오로라 빛 리본이 흘러요", lv3: "착지하면 오로라 커튼이 일렁여요",
    trail: [e("glow", ["#7af5d0", "#9d8cff"], 1, { speed: [2, 8], life: [0.4, 0.6], size: [3, 6], glow: true, hue: true, alpha: 0.5 })],
    streak: { colors: ["#46e6b4", "#9d8cff"], width: 6, life: 0.45, glow: true, hue: true },
    impact: { burst: [e("star", ["#7af5d0", "#c7b8ff"], 4, { speed: [30, 70], glow: true })] },
    land: { burst: [e("glow", ["#7af5d0", "#9d8cff", "#46e6b4"], 8, { speed: [30, 70], gravity: -40, life: [0.6, 1], size: [4, 7], glow: true, hue: true })], ring: [ring("#46e6b4", 24, { width: 3, glow: true }), ring("#9d8cff", 34, { delay: 0.1, width: 2, glow: true })] },
    sound: "cosmic",
  },
  "dice.lava": {
    lv2: "불씨가 피어오르고 열기가 일렁여요", lv3: "착지하면 용암이 튀고 바닥에 불균열이 생겨요",
    trail: [e("ember", ["#ffcf45", "#ff6a29", "#dc3725"], 1, { gravity: -70, speed: [5, 14], life: [0.45, 0.7], size: [2, 3.5], glow: true }), e("smoke", ["#5a1a0d"], 0.4, { gravity: -30, speed: [2, 6], life: [0.6, 0.9], size: [5, 8], grow: 2, alpha: 0.28 })],
    impact: { burst: [e("drop", ["#ff6a29", "#ffcf45"], 5, { speed: [60, 110], gravity: 280, glow: true })] },
    land: { burst: [e("drop", ["#ff6a29", "#ffcf45", "#dc3725"], 10, { speed: [60, 130], gravity: 300, glow: true, life: [0.4, 0.65] }), e("flame", ["#ff8a2a", "#ffcf45"], 4, { gravity: -90, speed: [5, 20], life: [0.4, 0.6], size: [5, 8], glow: true })], lines: [{ kind: "crack", color: "#ff7a2a", n: 6, length: 30, life: 1.1, width: 2, glow: true }] },
    sound: "fire",
  },
  "dice.galaxy": {
    lv2: "별빛과 성운이 흘러요", lv3: "착지하면 초신성 고리와 별가루가 퍼져요",
    trail: [e("star", ["#ffffff", "#c6a9ff", "#fddea6"], 1, { speed: [3, 10], life: [0.35, 0.6], size: [2.5, 4.5], glow: true }), e("smoke", ["#6b4cff", "#ff7ad9"], 0.4, { speed: [2, 6], life: [0.6, 0.9], size: [5, 8], grow: 1.8, alpha: 0.25, glow: true })],
    impact: { burst: [e("star", ["#ffffff", "#c6a9ff"], 4, { speed: [40, 80], glow: true })] },
    land: { burst: [e("star", ["#ffffff", "#c6a9ff", "#fddea6"], 12, { speed: [40, 110], glow: true, life: [0.5, 0.9], drag: 0.5 })], ring: [ring("#a48cff", 30, { width: 2.5, glow: true, fill: "rgba(120,90,255,0.10)" }), ring("#ffffff", 16, { delay: 0.05, width: 1.2, glow: true })] },
    sound: "cosmic",
  },
  "dice.neon_pink": {
    lv2: "핑크 네온 궤적과 작은 전기 불꽃", lv3: "충돌하면 전기가 튀고 착지하면 네온 파동이 퍼져요",
    trail: [e("spark", ["#ff7ad9", "#ffffff"], 0.5, { speed: [30, 60], life: [0.12, 0.22], size: [3, 5], glow: true })],
    streak: { colors: ["#ff4fcf", "#ff9be6"], width: 4, life: 0.32, glow: true },
    impact: { burst: [e("spark", ["#ff9be6", "#ffffff"], 4, { speed: [70, 130], life: [0.12, 0.22], glow: true })], lines: [{ kind: "arc", color: "#ffb3ec", n: 2, length: 26, life: 0.16, width: 1.6, glow: true }] },
    land: { burst: [e("spark", ["#ff4fcf", "#ffffff"], 6, { speed: [60, 120], life: [0.15, 0.3], glow: true })], ring: [ring("#ff4fcf", 26, { width: 3, glow: true }), ring("#4fe3ff", 36, { delay: 0.08, width: 1.5, glow: true })], lines: [{ kind: "arc", color: "#ffc4f0", n: 3, length: 30, life: 0.2, width: 1.6, glow: true }] },
    sound: "zap",
  },
  "dice.neon_green": {
    lv2: "그린 레이저 궤적이 남아요", lv3: "충돌하면 방전되고 착지하면 격자 파동이 퍼져요",
    trail: [e("dot", ["#39ff88", "#c9ffe0"], 0.6, { speed: [2, 6], life: [0.2, 0.35], size: [1.5, 2.5], glow: true })],
    streak: { colors: ["#39ff88", "#b7ffd5"], width: 3, life: 0.36, glow: true },
    impact: { burst: [e("spark", ["#7dffb0", "#ffffff"], 4, { speed: [70, 130], life: [0.12, 0.22], glow: true })], lines: [{ kind: "arc", color: "#a6ffc9", n: 2, length: 28, life: 0.16, width: 1.6, glow: true }] },
    land: { burst: [e("glitch", ["rgba(57,255,136,0.6)", "rgba(200,255,225,0.5)"], 4, { speed: [20, 50], life: [0.2, 0.35], size: [6, 10], glow: true })], ring: [ring("#39ff88", 24, { square: true, width: 2.5, glow: true }), ring("#39ff88", 36, { delay: 0.1, square: true, width: 1.2, glow: true })], lines: [{ kind: "arc", color: "#b7ffd5", n: 3, length: 30, life: 0.2, width: 1.5, glow: true }] },
    sound: "zap",
  },
  "dice.hologram": {
    lv2: "무지갯빛 프리즘과 잔상 노이즈", lv3: "착지하면 프리즘이 흩어지고 무지개 고리가 퍼져요",
    trail: [e("prism", ["#ff9ad5", "#9ad0ff", "#a8ffcf", "#fff4a3"], 1, { speed: [4, 12], life: [0.3, 0.5], size: [3, 5], spin: 4, glow: true, hue: true }), e("glitch", ["rgba(201,182,255,0.5)"], 0.3, { speed: [1, 3], life: [0.15, 0.25], size: [8, 12] })],
    impact: { burst: [e("prism", ["#ff9ad5", "#9ad0ff", "#a8ffcf"], 4, { speed: [40, 80], spin: 6, glow: true, hue: true })] },
    land: { burst: [e("prism", ["#ff9ad5", "#9ad0ff", "#a8ffcf", "#fff4a3", "#d2a8ff"], 12, { speed: [50, 110], spin: 8, glow: true, hue: true })], ring: [ring("#ff9ad5", 22, { width: 2, glow: true }), ring("#9ad0ff", 28, { delay: 0.05, width: 2, glow: true }), ring("#a8ffcf", 34, { delay: 0.1, width: 2, glow: true })] },
    sound: "cosmic",
  },
  "dice.gold": {
    lv2: "금박 조각이 반짝이며 흩날려요", lv3: "착지하면 황금빛 파동과 금화가 튀어요",
    trail: [e("flake", ["#ffd75e", "#fff0b3", "#c09226"], 1, { speed: [4, 12], life: [0.45, 0.7], size: [2.5, 4.5], spin: 8, gravity: 40 }), e("star", ["#fff4c2"], 0.3, { speed: [2, 6], life: [0.2, 0.35], glow: true })],
    impact: { burst: [e("flake", ["#ffd75e", "#fff0b3"], 5, { speed: [50, 100], spin: 10, gravity: 200 })] },
    land: { burst: [e("flake", ["#ffd75e", "#fff0b3", "#c09226"], 12, { speed: [60, 130], spin: 12, gravity: 260, life: [0.5, 0.8] }), e("star", ["#ffffff", "#fff4c2"], 4, { speed: [30, 70], glow: true })], ring: [ring("#ffd75e", 26, { width: 3, glow: true }), ring("#fff0b3", 38, { delay: 0.09, width: 1.5, glow: true })] },
    sound: "coin",
  },
  /* ---------------- nature & element collection (2026-11-27) ---------------- */
  "dice.thunder": {
    lv2: "구르는 길을 따라 푸른 전기가 지지직 흘러요", lv3: "부딪히면 번개가 갈라지고 착지하면 전격이 사방으로 퍼져요",
    trail: [e("spark", ["#ffffff", "#a9c6ff", "#6f8fff"], 1, { speed: [30, 70], gravity: 0, drag: 0.2, life: [0.12, 0.25], size: [2.5, 5], glow: true })],
    streak: { colors: ["#cfe0ff", "#6f8fff"], width: 1.6, life: 0.16, glow: true },
    impact: { burst: [e("spark", ["#ffffff", "#a9c6ff"], 5, { speed: [90, 170], life: [0.12, 0.25], size: [3, 6], glow: true })], lines: [{ kind: "arc", color: "#cfe0ff", n: 2, length: 26, life: 0.22, width: 1.4, glow: true }] },
    land: { burst: [e("spark", ["#ffffff", "#a9c6ff", "#6f8fff"], 9, { speed: [100, 200], life: [0.15, 0.3], size: [3, 6], glow: true })], lines: [{ kind: "arc", color: "#e6eeff", n: 5, length: 38, life: 0.3, width: 1.6, glow: true }], ring: [ring("#a9c6ff", 22, { glow: true, life: 0.35 })] },
    sound: "zap",
  },
  "dice.meadow": {
    lv2: "풀잎과 홀씨가 바람을 타고 따라와요", lv3: "착지하면 풀잎이 흩어지고 작은 들꽃이 고개를 내밀어요",
    trail: [e("leaf", ["#8cc152", "#b7e07c"], 1, { speed: [6, 14], spin: 5, gravity: 20, life: [0.5, 0.8], size: [2.5, 4] }), e("glow", ["#ffffff"], 0.4, { speed: [4, 10], gravity: -20, life: [0.6, 0.9], size: [1.5, 2.2], alpha: 0.7 })],
    impact: { burst: [e("leaf", ["#8cc152", "#5f9a36"], 3, { speed: [30, 60], spin: 6, gravity: 80 })] },
    land: { burst: [e("leaf", ["#8cc152", "#b7e07c", "#5f9a36"], 8, { speed: [40, 90], spin: 7, gravity: 90, life: [0.5, 0.8] }), e("flower", ["#fff27a", "#ffffff"], 2, { speed: [8, 18], life: [0.8, 1.1], size: [4, 6] })] },
    sound: "whoosh",
  },
  "dice.flower": {
    lv2: "작은 꽃송이가 피었다 지며 따라와요", lv3: "착지하면 꽃이 활짝 피고 꽃잎이 둥글게 흩날려요",
    trail: [e("flower", ["#ff8fb0", "#ffd36b", "#c9a0ff"], 0.6, { speed: [3, 8], life: [0.5, 0.8], size: [3.5, 5.5], spin: 1, grow: 1.3 })],
    impact: { burst: [e("petal", ["#ff8fb0", "#ffd36b"], 3, { speed: [30, 60], spin: 5 })] },
    land: { burst: [e("flower", ["#ff8fb0", "#ffd36b", "#c9a0ff"], 4, { speed: [15, 35], life: [0.8, 1.1], size: [5, 8], spin: 1, grow: 1.4 }), e("petal", ["#ffb3c8", "#fff0a8"], 8, { speed: [40, 80], spin: 6, drag: 0.4, life: [0.7, 1] })], ring: [ring("#ffb3c8", 24, { dashed: true, life: 0.7 })] },
    sound: "chime",
  },
  "dice.sakura": {
    lv2: "벚꽃잎이 회오리치며 따라와요", lv3: "착지하면 꽃잎이 소복이 내려앉고 가지 그림자가 일렁여요",
    trail: [e("petal", ["#ffc4d6", "#ffe3ea", "#ff9fba"], 1.2, { speed: [8, 20], spin: 6, gravity: 25, drag: 0.4, life: [0.6, 1], size: [2.5, 4.5] })],
    impact: { burst: [e("petal", ["#ffc4d6", "#ffffff"], 4, { speed: [40, 80], spin: 7, drag: 0.4 })] },
    land: { burst: [e("petal", ["#ffc4d6", "#ffe3ea", "#ff9fba"], 14, { speed: [30, 90], spin: 7, gravity: 30, drag: 0.5, life: [0.9, 1.3], size: [2.5, 5] })], ring: [ring("#ffc4d6", 28, { life: 0.8, fill: "rgba(255,196,214,0.10)" })] },
    sound: "chime",
  },
  "dice.abyss": {
    lv2: "심해의 발광 입자가 은은하게 따라와요", lv3: "착지하면 기포가 솟고 발광 물결이 두 겹으로 퍼져요",
    trail: [e("glow", ["#3fe0d0", "#9ffff4"], 1, { speed: [2, 8], life: [0.6, 0.9], size: [1.5, 3], glow: true, alpha: 0.8 }), e("bubble", ["#bff3ff"], 0.4, { gravity: -50, speed: [4, 10], life: [0.5, 0.8], size: [1.5, 3] })],
    impact: { burst: [e("bubble", ["#bff3ff", "#ffffff"], 4, { speed: [20, 50], gravity: -60, size: [1.5, 3.5] })] },
    land: { burst: [e("bubble", ["#bff3ff", "#9ffff4", "#ffffff"], 10, { speed: [20, 60], gravity: -90, life: [0.7, 1.1], size: [1.5, 4] }), e("glow", ["#3fe0d0"], 6, { speed: [20, 50], glow: true, life: [0.6, 0.9] })], ring: [ring("#3fe0d0", 22, { glow: true, life: 0.8 }), ring("#9ffff4", 34, { delay: 0.15, life: 0.9 })] },
    sound: "glass",
  },
};

/** Profile for a dice item (null for the basic die and unknown ids). */
export const diceFx = (id: string | undefined | null): DiceFxProfile | null => (id ? DICE_FX[id] ?? null : null);

import type { Emitter, Lines, Ring } from "./dice3d/dice-fx";
import type { LandSound } from "./dice3d/dice-fx";

/**
 * Board upgrade effects (2026-11-26), one profile per board item. Data only (also read by the catalog).
 *
 *  Lv.1  the board's own surface (CSS) — unchanged.
 *  Lv.2  a living environment: slow ambient motion drawn under the dice (`ambient`, `drift`).
 *  Lv.3  Lv.2 plus reactions to the game: a roll, each die landing, holding a die, a large straight,
 *        a yacht and a win (`react`), some with a quiet accent sound.
 *
 * The layer sits under the dice canvas, never over pips, buttons or the score sheet, keeps a low
 * contrast, and is scaled by the effect budget (none for reduced motion; paused off screen / hidden).
 */
export type Ambient =
  | "caustics" | "rays" | "grid" | "aurora" | "sweep" | "twinkle" | "lamp" | "dunes" | "frost" | "sheen" | "none";
export type BoardReaction = { burst?: Emitter[]; ring?: Ring[]; lines?: Lines[]; sound?: LandSound };
export type BoardFxProfile = {
  lv2: string;
  lv3: string;
  /** Background motion drawn every frame (~30 fps). */
  ambient: Ambient;
  ambientColor: string;
  /** Particles that keep drifting across the surface (per second; spawn area). */
  drift?: { spec: Emitter; perSecond: number; from: "top" | "bottom" | "any" };
  react: {
    roll?: BoardReaction;
    land?: BoardReaction;
    hold?: BoardReaction;
    grand: BoardReaction;
    win: BoardReaction;
  };
};

const e = (shape: Emitter["shape"], colors: string[], n: number, o: Partial<Emitter> = {}): Emitter => ({ shape, colors, n, speed: [10, 30], life: [0.5, 0.9], size: [2, 4], ...o });
const ring = (color: string, radius: number, o: Partial<Ring> = {}): Ring => ({ color, radius, width: 1.5, life: 0.7, ...o });

const feltDust = (color: string) => e("dot", [color, "#ffffff"], 1, { speed: [2, 6], life: [3, 5], size: [1, 1.8], alpha: 0.25, drag: 0.1 });
const felt = (name: string, color: string, accent: string): BoardFxProfile => ({
  lv2: `${name} 위로 조명이 천천히 흐르고 먼지가 떠다녀요`,
  lv3: "착지 자국이 펠트에 남고 족보·승리에 조명이 반짝여요",
  ambient: "lamp", ambientColor: accent,
  drift: { spec: feltDust(accent), perSecond: 1.2, from: "any" },
  react: {
    land: { ring: [ring("rgba(0,0,0,0.35)", 14, { width: 4, life: 0.9, fill: "rgba(0,0,0,0.12)" })] },
    hold: { burst: [e("dot", [accent], 3, { speed: [10, 30], life: [0.3, 0.5], alpha: 0.6 })] },
    grand: { burst: [e("star", [accent, "#ffffff"], 10, { speed: [40, 120], glow: true, life: [0.6, 1] })], ring: [ring(accent, 80, { width: 2, glow: true, life: 1 })], sound: "chime" },
    win: { burst: [e("star", [accent, "#ffffff", color], 18, { speed: [60, 160], glow: true, life: [0.8, 1.3] })], sound: "bell" },
  },
});

export const BOARD_FX: Record<string, BoardFxProfile> = {
  "board.felt": felt("녹색 펠트", "#1f4a36", "#b7f0cf"),
  "board.navy": {
    lv2: "남색 수면에 달빛이 일렁여요", lv3: "주사위가 떨어진 자리에 잔물결이 퍼져요",
    ambient: "sheen", ambientColor: "#a6c7ff",
    drift: { spec: e("dot", ["#cfe0ff"], 1, { speed: [2, 5], life: [3, 5], size: [1, 1.6], alpha: 0.3 }), perSecond: 1, from: "any" },
    react: {
      land: { ring: [ring("#a6c7ff", 20, { life: 0.8 })] },
      hold: { ring: [ring("#a6c7ff", 10, { life: 0.4 })] },
      grand: { ring: [ring("#cfe0ff", 90, { width: 2, glow: true, life: 1.1 }), ring("#a6c7ff", 60, { delay: 0.15, life: 1 })], sound: "chime" },
      win: { burst: [e("star", ["#cfe0ff", "#ffffff"], 16, { speed: [60, 150], glow: true, life: [0.8, 1.3] })], sound: "bell" },
    },
  },
  "board.christmas": {
    lv2: "선착장 위로 눈이 내려요", lv3: "착지하면 눈이 흩날리고 요트·승리에 종이 울려요",
    ambient: "twinkle", ambientColor: "#fff9dc",
    drift: { spec: e("snow", ["#ffffff", "#e8f6ff"], 1, { speed: [6, 14], life: [4, 6], size: [2, 3.5], gravity: 6, spin: 1, alpha: 0.75 }), perSecond: 4, from: "top" },
    react: {
      land: { burst: [e("snow", ["#ffffff"], 3, { speed: [20, 50], life: [0.6, 1], spin: 2 })] },
      hold: { burst: [e("star", ["#ffe6a0"], 2, { speed: [10, 30], glow: true })] },
      grand: { burst: [e("snow", ["#ffffff", "#ffe6a0", "#e05a74"], 16, { speed: [50, 140], spin: 3, life: [0.8, 1.2] })], sound: "bell" },
      win: { burst: [e("snow", ["#ffffff", "#ffe6a0", "#7fd3a0", "#e05a74"], 26, { speed: [60, 180], spin: 3, life: [1, 1.6] })], sound: "bell" },
    },
  },
  "board.felt_red": felt("레드 펠트", "#5a1d1d", "#ffc4b5"),
  "board.felt_blue": felt("블루 펠트", "#1d2f5a", "#bcd2ff"),
  "board.felt_purple": felt("퍼플 펠트", "#3b2152", "#e2c6ff"),
  "board.felt_sand": felt("베이지 펠트", "#6b5a3e", "#ffe9c2"),
  "board.wood_oak": {
    lv2: "따뜻한 램프 빛과 나뭇결 위 먼지", lv3: "착지하면 나무 먼지가 일고 승리에 낙엽이 흩날려요",
    ambient: "lamp", ambientColor: "#ffd9a0",
    drift: { spec: e("dot", ["#ffe2b8"], 1, { speed: [2, 6], life: [3, 5], size: [1, 1.8], alpha: 0.3 }), perSecond: 1.2, from: "any" },
    react: {
      land: { burst: [e("smoke", ["#c79a6c"], 2, { speed: [5, 15], life: [0.5, 0.8], size: [4, 6], grow: 2, alpha: 0.25 })], sound: "thud" },
      hold: { burst: [e("dot", ["#ffd9a0"], 3, { speed: [10, 25], life: [0.3, 0.5] })] },
      grand: { burst: [e("leaf", ["#e8a23c", "#c4632a", "#a9dd67"], 14, { speed: [50, 130], spin: 5, gravity: 40, life: [0.9, 1.3] })], sound: "whoosh" },
      win: { burst: [e("leaf", ["#e8a23c", "#c4632a", "#a9dd67", "#f2d06b"], 22, { speed: [60, 160], spin: 5, gravity: 40, life: [1, 1.6] })], sound: "chime" },
    },
  },
  "board.wood_walnut": {
    lv2: "짙은 원목에 촛불 같은 빛이 일렁여요", lv3: "착지하면 묵직한 울림과 먼지, 승리에 불빛이 퍼져요",
    ambient: "lamp", ambientColor: "#ffb870",
    drift: { spec: e("ember", ["#ffb870"], 1, { speed: [2, 6], life: [3, 5], size: [0.8, 1.5], alpha: 0.35, gravity: -3, glow: true }), perSecond: 0.8, from: "bottom" },
    react: {
      land: { ring: [ring("rgba(0,0,0,0.4)", 16, { width: 4, life: 0.8, fill: "rgba(0,0,0,0.15)" })], sound: "thud" },
      hold: { burst: [e("ember", ["#ffb870"], 2, { speed: [10, 25], glow: true })] },
      grand: { burst: [e("ember", ["#ffb870", "#ffe0b8"], 14, { speed: [40, 120], glow: true, gravity: -40, life: [0.8, 1.2] })], sound: "fire" },
      win: { burst: [e("ember", ["#ffb870", "#ffe0b8", "#ffffff"], 22, { speed: [60, 160], glow: true, gravity: -40, life: [1, 1.6] })], sound: "chime" },
    },
  },
  "board.leather_brown": {
    lv2: "가죽 결을 따라 은은한 광택이 지나가요", lv3: "착지하면 가죽이 살짝 눌리고 족보에 스티치가 빛나요",
    ambient: "sheen", ambientColor: "#f3d1a8",
    react: {
      land: { ring: [ring("rgba(0,0,0,0.35)", 12, { width: 5, life: 0.9, fill: "rgba(0,0,0,0.15)" })] },
      hold: { ring: [ring("#f3d1a8", 9, { life: 0.35, dashed: true })] },
      grand: { ring: [ring("#f3d1a8", 70, { dashed: true, width: 2, glow: true, life: 1, square: true })], sound: "chime" },
      win: { ring: [ring("#f3d1a8", 110, { dashed: true, width: 2, glow: true, life: 1.4, square: true }), ring("#ffffff", 80, { delay: 0.15, dashed: true, glow: true, square: true })], burst: [e("star", ["#f3d1a8", "#ffffff"], 12, { speed: [60, 140], glow: true })], sound: "bell" },
    },
  },
  "board.leather_black": {
    lv2: "검은 가죽 위로 은빛 광택이 흘러요", lv3: "착지 자국과 은빛 스티치, 승리에 은빛 섬광",
    ambient: "sheen", ambientColor: "#d8dde6",
    react: {
      land: { ring: [ring("rgba(0,0,0,0.5)", 12, { width: 5, life: 0.9, fill: "rgba(0,0,0,0.2)" })] },
      hold: { ring: [ring("#d8dde6", 9, { life: 0.35, dashed: true })] },
      grand: { ring: [ring("#d8dde6", 70, { dashed: true, width: 2, glow: true, life: 1, square: true })], sound: "coin" },
      win: { burst: [e("star", ["#ffffff", "#d8dde6"], 16, { speed: [60, 150], glow: true })], ring: [ring("#d8dde6", 110, { dashed: true, glow: true, square: true, life: 1.3 })], sound: "bell" },
    },
  },
  "board.marble": {
    lv2: "대리석 결 위로 빛줄기가 미끄러져요", lv3: "착지하면 결을 따라 빛이 번지고 족보에 결이 빛나요",
    ambient: "sweep", ambientColor: "#e6defb",
    react: {
      land: { lines: [{ kind: "crack", color: "rgba(230,222,251,0.6)", n: 3, length: 22, life: 0.8, width: 1 }] },
      hold: { ring: [ring("#d4c7ff", 10, { life: 0.4 })] },
      grand: { lines: [{ kind: "crack", color: "#d4c7ff", n: 8, length: 90, life: 1.2, width: 1.5, glow: true }], sound: "crack" },
      win: { lines: [{ kind: "crack", color: "#efe8ff", n: 12, length: 140, life: 1.5, width: 1.5, glow: true }], burst: [e("star", ["#ffffff", "#d4c7ff"], 10, { speed: [40, 120], glow: true })], sound: "chime" },
    },
  },
  "board.ocean": {
    lv2: "물결 무늬 빛이 바닥에 일렁여요", lv3: "주사위가 떨어진 곳에 물결과 물보라가 일어요",
    ambient: "caustics", ambientColor: "#8de5f4",
    drift: { spec: e("bubble", ["#bff3ff"], 1, { speed: [2, 6], gravity: -12, life: [3, 4], size: [1.5, 3], alpha: 0.4 }), perSecond: 1, from: "bottom" },
    react: {
      roll: { ring: [ring("#72e0ff", 40, { life: 0.9 })] },
      land: { ring: [ring("#9ff0ff", 22, { width: 1.5, life: 0.9 }), ring("#72e0ff", 34, { delay: 0.12, life: 0.9 })], burst: [e("drop", ["#bff3ff", "#ffffff"], 3, { speed: [30, 70], gravity: 160, life: [0.3, 0.5] })] },
      hold: { ring: [ring("#9ff0ff", 10, { life: 0.4 })] },
      grand: { ring: [ring("#9ff0ff", 120, { width: 2.5, life: 1.3, glow: true }), ring("#72e0ff", 90, { delay: 0.2, width: 2, life: 1.2 })], sound: "whoosh" },
      win: { burst: [e("bubble", ["#bff3ff", "#ffffff"], 24, { speed: [30, 90], gravity: -60, life: [1, 1.6], size: [2, 5] })], ring: [ring("#9ff0ff", 150, { width: 2, glow: true, life: 1.5 })], sound: "whoosh" },
    },
  },
  "board.desert": {
    lv2: "모래 물결 위로 모래 바람이 불어요", lv3: "착지하면 모래가 튀고 족보에 신기루가 일렁여요",
    ambient: "dunes", ambientColor: "#ffcd78",
    drift: { spec: e("dot", ["#ffd99a", "#e8b86a"], 1, { speed: [30, 50], life: [1.5, 2.5], size: [0.8, 1.5], alpha: 0.4, drag: 0 }), perSecond: 6, from: "any" },
    react: {
      land: { burst: [e("dot", ["#e8b86a", "#ffd99a"], 6, { speed: [30, 80], gravity: 160, life: [0.3, 0.5], size: [1, 2] })] },
      hold: { burst: [e("dot", ["#ffd99a"], 3, { speed: [10, 30] })] },
      grand: { burst: [e("smoke", ["#ffd99a", "#e8b86a"], 10, { speed: [40, 100], grow: 2.5, alpha: 0.25, size: [8, 12], life: [0.9, 1.3] })], sound: "whoosh" },
      win: { burst: [e("star", ["#fff0c2", "#ffd99a"], 16, { speed: [60, 150], glow: true })], sound: "chime" },
    },
  },
  "board.ice": {
    lv2: "서리가 반짝이며 차가운 김이 흘러요", lv3: "착지하면 얼음에 금이 가고 승리에 결정이 피어요",
    ambient: "frost", ambientColor: "#dafbff",
    drift: { spec: e("smoke", ["#e6f9ff"], 1, { speed: [4, 10], life: [3, 4], size: [10, 16], grow: 1.6, alpha: 0.08 }), perSecond: 0.8, from: "bottom" },
    react: {
      land: { lines: [{ kind: "crack", color: "rgba(220,250,255,0.75)", n: 4, length: 26, life: 1, width: 1 }], sound: "ice" },
      hold: { burst: [e("crystal", ["#dafbff"], 2, { speed: [10, 25], glow: true })] },
      grand: { burst: [e("snow", ["#ffffff", "#c7f8ff"], 14, { speed: [50, 130], spin: 2 })], lines: [{ kind: "crack", color: "#c7f8ff", n: 8, length: 90, life: 1.3, width: 1.4, glow: true }], sound: "ice" },
      win: { burst: [e("snow", ["#ffffff", "#c7f8ff"], 24, { speed: [60, 170], spin: 2, life: [1, 1.5] })], sound: "ice" },
    },
  },
  "board.space": {
    lv2: "별이 반짝이고 성운이 천천히 흘러요", lv3: "착지하면 중력파가 퍼지고 족보에 유성이 떨어져요",
    ambient: "twinkle", ambientColor: "#c6a3ff",
    drift: { spec: e("star", ["#ffffff", "#c6a3ff"], 1, { speed: [1, 3], life: [1.5, 3], size: [1.5, 2.5], glow: true, alpha: 0.7 }), perSecond: 2, from: "any" },
    react: {
      roll: { burst: [e("star", ["#ffffff"], 4, { speed: [80, 160], life: [0.3, 0.5], glow: true })] },
      land: { ring: [ring("#c6a3ff", 28, { glow: true, life: 0.9, fill: "rgba(140,100,255,0.06)" })] },
      hold: { burst: [e("star", ["#c6a3ff"], 2, { speed: [10, 25], glow: true })] },
      grand: { burst: [e("spark", ["#ffffff", "#c6a3ff"], 10, { speed: [180, 320], life: [0.4, 0.7], glow: true, gravity: 60 })], ring: [ring("#c6a3ff", 110, { width: 2, glow: true, life: 1.2 })], sound: "cosmic" },
      win: { burst: [e("star", ["#ffffff", "#c6a3ff", "#fddea6"], 28, { speed: [60, 180], glow: true, life: [1, 1.6] })], sound: "cosmic" },
    },
  },
  "board.neon": {
    lv2: "발광 격자에 전류가 흘러요", lv3: "충돌 지점에서 빛이 격자를 따라 퍼져요",
    ambient: "grid", ambientColor: "#ff70d4",
    react: {
      roll: { lines: [{ kind: "arc", color: "#57dcff", n: 2, length: 60, life: 0.2, width: 1.2, glow: true }] },
      land: { ring: [ring("#ff70d4", 24, { square: true, glow: true, life: 0.7 }), ring("#57dcff", 36, { square: true, delay: 0.1, glow: true, life: 0.7 })] },
      hold: { ring: [ring("#57dcff", 10, { square: true, glow: true, life: 0.35 })] },
      grand: { ring: [ring("#ff70d4", 120, { square: true, width: 2.5, glow: true, life: 1.1 }), ring("#57dcff", 90, { square: true, delay: 0.12, width: 2, glow: true, life: 1 })], lines: [{ kind: "arc", color: "#ffc4f0", n: 6, length: 90, life: 0.35, width: 1.5, glow: true }], sound: "zap" },
      win: { lines: [{ kind: "arc", color: "#ffc4f0", n: 10, length: 140, life: 0.5, width: 1.6, glow: true }], ring: [ring("#57dcff", 160, { square: true, glow: true, life: 1.4 })], sound: "zap" },
    },
  },
  "board.aurora": {
    lv2: "오로라 커튼이 천천히 일렁여요", lv3: "착지하면 빛의 물결이 일고 승리에 오로라가 타올라요",
    ambient: "aurora", ambientColor: "#7dffcb",
    drift: { spec: e("star", ["#ffffff"], 1, { speed: [1, 3], life: [1.5, 3], size: [1.2, 2], glow: true, alpha: 0.6 }), perSecond: 1, from: "top" },
    react: {
      land: { ring: [ring("#7dffcb", 24, { glow: true, life: 0.8 })] },
      hold: { burst: [e("glow", ["#7dffcb"], 2, { speed: [10, 20], glow: true, size: [3, 5] })] },
      grand: { burst: [e("glow", ["#7dffcb", "#9d8cff"], 12, { speed: [30, 90], gravity: -40, glow: true, hue: true, size: [4, 8] })], sound: "cosmic" },
      win: { burst: [e("glow", ["#7dffcb", "#9d8cff", "#46e6b4"], 22, { speed: [40, 120], gravity: -50, glow: true, hue: true, size: [4, 9], life: [1.2, 1.8] })], sound: "cosmic" },
    },
  },
  "board.gold_table": {
    lv2: "금빛 표면 위로 반사광이 지나가요", lv3: "착지하면 금빛 파동, 족보와 승리에 금화가 쏟아져요",
    ambient: "sweep", ambientColor: "#ffe0a1",
    drift: { spec: e("star", ["#fff4c2"], 1, { speed: [1, 3], life: [0.8, 1.4], size: [1.5, 2.5], glow: true, alpha: 0.7 }), perSecond: 1.5, from: "any" },
    react: {
      land: { ring: [ring("#ffe0a1", 22, { glow: true, life: 0.8 })] },
      hold: { burst: [e("star", ["#fff4c2"], 2, { speed: [10, 25], glow: true })] },
      grand: { burst: [e("flake", ["#ffd75e", "#fff0b3", "#c09226"], 18, { speed: [60, 160], spin: 10, gravity: 220, life: [0.8, 1.2] })], sound: "coin" },
      win: { burst: [e("flake", ["#ffd75e", "#fff0b3", "#c09226"], 30, { speed: [80, 200], spin: 12, gravity: 240, life: [1, 1.6] })], ring: [ring("#ffe0a1", 150, { glow: true, width: 2.5, life: 1.4 })], sound: "coin" },
    },
  },
  "board.deep_sea": {
    lv2: "심해로 빛줄기가 내려오고 기포가 올라가요", lv3: "착지하면 굴절된 물결과 기포, 승리에 발광 생물이 모여요",
    ambient: "rays", ambientColor: "#74e7dc",
    drift: { spec: e("bubble", ["#a9fff6", "#ffffff"], 1, { speed: [2, 6], gravity: -18, life: [3, 5], size: [1.5, 3.5], alpha: 0.45 }), perSecond: 1.6, from: "bottom" },
    react: {
      roll: { burst: [e("bubble", ["#a9fff6"], 4, { speed: [10, 30], gravity: -60, life: [0.8, 1.2] })] },
      land: { ring: [ring("#74e7dc", 20, { life: 1 }), ring("#a9fff6", 32, { delay: 0.15, life: 1 })], burst: [e("bubble", ["#a9fff6", "#ffffff"], 3, { speed: [10, 30], gravity: -50, life: [0.8, 1.2] })] },
      hold: { burst: [e("bubble", ["#a9fff6"], 2, { speed: [5, 15], gravity: -50 })] },
      grand: { burst: [e("glow", ["#74e7dc", "#a9fff6", "#c6a3ff"], 14, { speed: [20, 70], glow: true, size: [3, 6], life: [1, 1.5] })], ring: [ring("#a9fff6", 120, { width: 2, glow: true, life: 1.3 })], sound: "whoosh" },
      win: { burst: [e("glow", ["#74e7dc", "#a9fff6", "#c6a3ff"], 26, { speed: [30, 110], glow: true, size: [3, 7], life: [1.3, 2] }), e("bubble", ["#ffffff"], 10, { speed: [20, 60], gravity: -60 })], sound: "whoosh" },
    },
  },
};

export const boardFx = (id: string | undefined | null): BoardFxProfile | null => (id ? BOARD_FX[id] ?? null : null);

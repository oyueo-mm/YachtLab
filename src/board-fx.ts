import type { Emitter, Lines, Ring } from "./dice3d/dice-fx";
import type { LandSound } from "./dice3d/dice-fx";

/**
 * Board upgrade effects (2026-11-26), one profile per board item. Data only (also read by the catalog).
 *
 *  Lv.1  the board's own surface (CSS).
 *  Lv.2  a living environment — src/play/board-scene.ts (each board its own procedural motion).
 *  Lv.3  Lv.2 plus local reactions at the real collision point and strength (board-scene.ts), and the
 *        big moments here: holding a die, a large straight, a yacht and a win (`react`), with quiet
 *        accent sounds.
 *
 * The layer sits under the dice canvas, never over pips, buttons or the score sheet, keeps a low
 * contrast, and is scaled by the effect budget (none for reduced motion; paused off screen / hidden).
 */
export type BoardReaction = { burst?: Emitter[]; ring?: Ring[]; lines?: Lines[]; sound?: LandSound };
import { BOARD_FX_TEXT as TEXT } from "./fx-texts";
export type BoardFxProfile = {
  lv2: string;
  lv3: string;
  /** Lv.2 environment and Lv.3 local reactions: procedural, per board, in src/play/board-scene.ts. */
  react: {
    /** Only the accent sound (once per throw); the visual landing reaction is the board's scene. */
    land?: BoardReaction;
    hold?: BoardReaction;
    grand: BoardReaction;
    win: BoardReaction;
  };
};

const e = (shape: Emitter["shape"], colors: string[], n: number, o: Partial<Emitter> = {}): Emitter => ({ shape, colors, n, speed: [10, 30], life: [0.5, 0.9], size: [2, 4], ...o });
const ring = (color: string, radius: number, o: Partial<Ring> = {}): Ring => ({ color, radius, width: 1.5, life: 0.7, ...o });

const feltDust = (color: string) => e("dot", [color, "#ffffff"], 1, { speed: [2, 6], life: [3, 5], size: [1, 1.8], alpha: 0.25, drag: 0.1 });
const felt = (id: string, color: string, accent: string): BoardFxProfile => ({
  lv2: TEXT[id][0],
  lv3: TEXT[id][1],
  react: {
    hold: { burst: [e("dot", [accent], 3, { speed: [10, 30], life: [0.3, 0.5], alpha: 0.6 })] },
    grand: { burst: [e("star", [accent, "#ffffff"], 10, { speed: [40, 120], glow: true, life: [0.6, 1] })], ring: [ring(accent, 80, { width: 2, glow: true, life: 1 })], sound: "chime" },
    win: { burst: [e("star", [accent, "#ffffff", color], 18, { speed: [60, 160], glow: true, life: [0.8, 1.3] })], sound: "bell" },
  },
});

export const BOARD_FX: Record<string, BoardFxProfile> = {
  "board.felt": felt("board.felt", "#1f4a36", "#b7f0cf"),
  "board.navy": {
    lv2: "달빛이 수면에서 반짝이며 길을 만들어요", lv3: "떨어진 자리에서 물결이 퍼지고 물결이 지나간 달빛이 반짝여요",
    react: {
      hold: { ring: [ring("#a6c7ff", 10, { life: 0.4 })] },
      grand: { ring: [ring("#cfe0ff", 90, { width: 2, glow: true, life: 1.1 }), ring("#a6c7ff", 60, { delay: 0.15, life: 1 })], sound: "chime" },
      win: { burst: [e("star", ["#cfe0ff", "#ffffff"], 16, { speed: [60, 150], glow: true, life: [0.8, 1.3] })], sound: "bell" },
    },
  },
  "board.christmas": {
    lv2: "눈이 내리고 위쪽 전구가 차례로 반짝여요", lv3: "착지하면 눈이 튀고 작은 눈더미가 남아요. 세게 치면 전구가 번쩍여요",
    react: {
      hold: { burst: [e("star", ["#ffe6a0"], 2, { speed: [10, 30], glow: true })] },
      grand: { burst: [e("snow", ["#ffffff", "#ffe6a0", "#e05a74"], 16, { speed: [50, 140], spin: 3, life: [0.8, 1.2] })], sound: "bell" },
      win: { burst: [e("snow", ["#ffffff", "#ffe6a0", "#7fd3a0", "#e05a74"], 26, { speed: [60, 180], spin: 3, life: [1, 1.6] })], sound: "bell" },
    },
  },
  "board.felt_red": felt("board.felt_red", "#5a1d1d", "#ffc4b5"),
  "board.felt_blue": felt("board.felt_blue", "#1d2f5a", "#bcd2ff"),
  "board.felt_purple": felt("board.felt_purple", "#3b2152", "#e2c6ff"),
  "board.felt_sand": felt("board.felt_sand", "#6b5a3e", "#ffe9c2"),
  "board.wood_oak": {
    lv2: "비스듬한 햇살 속에서 먼지가 떠다녀요", lv3: "부딪힌 자리에서 나뭇결을 따라 울림이 퍼져요",
    react: {
      land: { sound: "thud" },
      hold: { burst: [e("dot", ["#ffd9a0"], 3, { speed: [10, 25], life: [0.3, 0.5] })] },
      grand: { burst: [e("leaf", ["#e8a23c", "#c4632a", "#a9dd67"], 14, { speed: [50, 130], spin: 5, gravity: 40, life: [0.9, 1.3] })], sound: "whoosh" },
      win: { burst: [e("leaf", ["#e8a23c", "#c4632a", "#a9dd67", "#f2d06b"], 22, { speed: [60, 160], spin: 5, gravity: 40, life: [1, 1.6] })], sound: "chime" },
    },
  },
  "board.wood_walnut": {
    lv2: "촛불 빛이 일렁이고 가끔 불씨가 올라가요", lv3: "부딪히면 나뭇결로 울림이 퍼지고 촛불이 흔들려요",
    react: {
      land: { sound: "thud" },
      hold: { burst: [e("ember", ["#ffb870"], 2, { speed: [10, 25], glow: true })] },
      grand: { burst: [e("ember", ["#ffb870", "#ffe0b8"], 14, { speed: [40, 120], glow: true, gravity: -40, life: [0.8, 1.2] })], sound: "fire" },
      win: { burst: [e("ember", ["#ffb870", "#ffe0b8", "#ffffff"], 22, { speed: [60, 160], glow: true, gravity: -40, life: [1, 1.6] })], sound: "chime" },
    },
  },
  "board.leather_brown": {
    lv2: "광택이 오가고 바느질을 따라 빛이 돌아요", lv3: "부딪힌 자리가 눌리고 가까운 바느질이 빛나요",
    react: {
      hold: { ring: [ring("#f3d1a8", 9, { life: 0.35, dashed: true })] },
      grand: { ring: [ring("#f3d1a8", 70, { dashed: true, width: 2, glow: true, life: 1, square: true })], sound: "chime" },
      win: { ring: [ring("#f3d1a8", 110, { dashed: true, width: 2, glow: true, life: 1.4, square: true }), ring("#ffffff", 80, { delay: 0.15, dashed: true, glow: true, square: true })], burst: [e("star", ["#f3d1a8", "#ffffff"], 12, { speed: [60, 140], glow: true })], sound: "bell" },
    },
  },
  "board.leather_black": {
    lv2: "은빛 광택이 흐르고 바느질을 따라 은빛이 돌아요", lv3: "부딪힌 자리가 눌리고 가까운 은빛 바느질이 빛나요",
    react: {
      hold: { ring: [ring("#d8dde6", 9, { life: 0.35, dashed: true })] },
      grand: { ring: [ring("#d8dde6", 70, { dashed: true, width: 2, glow: true, life: 1, square: true })], sound: "coin" },
      win: { burst: [e("star", ["#ffffff", "#d8dde6"], 16, { speed: [60, 150], glow: true })], ring: [ring("#d8dde6", 110, { dashed: true, glow: true, square: true, life: 1.3 })], sound: "bell" },
    },
  },
  "board.marble": {
    lv2: "대리석 결을 따라 빛이 미끄러져요", lv3: "부딪힌 자리에서 가까운 결을 따라 빛이 번져요",
    react: {
      hold: { ring: [ring("#d4c7ff", 10, { life: 0.4 })] },
      grand: { lines: [{ kind: "crack", color: "#d4c7ff", n: 8, length: 90, life: 1.2, width: 1.5, glow: true }], sound: "crack" },
      win: { lines: [{ kind: "crack", color: "#efe8ff", n: 12, length: 140, life: 1.5, width: 1.5, glow: true }], burst: [e("star", ["#ffffff", "#d4c7ff"], 10, { speed: [40, 120], glow: true })], sound: "chime" },
    },
  },
  "board.ocean": {
    lv2: "얕은 물 밑에서 물결 빛 무늬가 일렁여요", lv3: "떨어진 자리에 물보라가 튀고 물결이 빛 무늬를 흔들어요",
    react: {
      hold: { ring: [ring("#9ff0ff", 10, { life: 0.4 })] },
      grand: { ring: [ring("#9ff0ff", 120, { width: 2.5, life: 1.3, glow: true }), ring("#72e0ff", 90, { delay: 0.2, width: 2, life: 1.2 })], sound: "whoosh" },
      win: { burst: [e("bubble", ["#bff3ff", "#ffffff"], 24, { speed: [30, 90], gravity: -60, life: [1, 1.6], size: [2, 5] })], ring: [ring("#9ff0ff", 150, { width: 2, glow: true, life: 1.5 })], sound: "whoosh" },
    },
  },
  "board.desert": {
    lv2: "모래 물결이 움직이고 모래바람이 지나가요", lv3: "떨어진 자리가 패이고 모래가 튀며 주변 모래 물결이 밀려나요",
    react: {
      hold: { burst: [e("dot", ["#ffd99a"], 3, { speed: [10, 30] })] },
      grand: { burst: [e("smoke", ["#ffd99a", "#e8b86a"], 10, { speed: [40, 100], grow: 2.5, alpha: 0.25, size: [8, 12], life: [0.9, 1.3] })], sound: "whoosh" },
      win: { burst: [e("star", ["#fff0c2", "#ffd99a"], 16, { speed: [60, 150], glow: true })], sound: "chime" },
    },
  },
  "board.ice": {
    lv2: "가장자리 서리가 자랐다 줄어들고 냉기가 흘러요", lv3: "세게 부딪히면 얼음에 금이 가고 착지한 자리에 결정이 피어요",
    react: {
      land: { sound: "ice" },
      hold: { burst: [e("crystal", ["#dafbff"], 2, { speed: [10, 25], glow: true })] },
      grand: { burst: [e("snow", ["#ffffff", "#c7f8ff"], 14, { speed: [50, 130], spin: 2 })], lines: [{ kind: "crack", color: "#c7f8ff", n: 8, length: 90, life: 1.3, width: 1.4, glow: true }], sound: "ice" },
      win: { burst: [e("snow", ["#ffffff", "#c7f8ff"], 24, { speed: [60, 170], spin: 2, life: [1, 1.5] })], sound: "ice" },
    },
  },
  "board.space": {
    lv2: "별이 반짝이고 성운이 흐르며 가끔 유성이 지나가요", lv3: "부딪힌 자리에서 중력파가 퍼져 별빛이 휘어요",
    react: {
      hold: { burst: [e("star", ["#c6a3ff"], 2, { speed: [10, 25], glow: true })] },
      grand: { burst: [e("spark", ["#ffffff", "#c6a3ff"], 10, { speed: [180, 320], life: [0.4, 0.7], glow: true, gravity: 60 })], ring: [ring("#c6a3ff", 110, { width: 2, glow: true, life: 1.2 })], sound: "cosmic" },
      win: { burst: [e("star", ["#ffffff", "#c6a3ff", "#fddea6"], 28, { speed: [60, 180], glow: true, life: [1, 1.6] })], sound: "cosmic" },
    },
  },
  "board.neon": {
    lv2: "회로를 따라 빛 신호가 흘러요", lv3: "부딪힌 자리에서 전자기 파동이 퍼지고 회로 접점이 켜져요",
    react: {
      hold: { ring: [ring("#57dcff", 10, { square: true, glow: true, life: 0.35 })] },
      grand: { ring: [ring("#ff70d4", 120, { square: true, width: 2.5, glow: true, life: 1.1 }), ring("#57dcff", 90, { square: true, delay: 0.12, width: 2, glow: true, life: 1 })], lines: [{ kind: "arc", color: "#ffc4f0", n: 6, length: 90, life: 0.35, width: 1.5, glow: true }], sound: "zap" },
      win: { lines: [{ kind: "arc", color: "#ffc4f0", n: 10, length: 140, life: 0.5, width: 1.6, glow: true }], ring: [ring("#57dcff", 160, { square: true, glow: true, life: 1.4 })], sound: "zap" },
    },
  },
  "board.aurora": {
    lv2: "오로라 빛줄기가 옆으로 물결쳐요", lv3: "부딪힌 자리로 오로라가 휘고 무지갯빛 고리가 퍼져요",
    react: {
      hold: { burst: [e("glow", ["#7dffcb"], 2, { speed: [10, 20], glow: true, size: [3, 5] })] },
      grand: { burst: [e("glow", ["#7dffcb", "#9d8cff"], 12, { speed: [30, 90], gravity: -40, glow: true, hue: true, size: [4, 8] })], sound: "cosmic" },
      win: { burst: [e("glow", ["#7dffcb", "#9d8cff", "#46e6b4"], 22, { speed: [40, 120], gravity: -50, glow: true, hue: true, size: [4, 9], life: [1.2, 1.8] })], sound: "cosmic" },
    },
  },
  "board.gold_table": {
    lv2: "반사광이 지나가며 금빛이 반짝여요", lv3: "부딪힌 자리가 녹은 금처럼 출렁여요",
    react: {
      hold: { burst: [e("star", ["#fff4c2"], 2, { speed: [10, 25], glow: true })] },
      grand: { burst: [e("flake", ["#ffd75e", "#fff0b3", "#c09226"], 18, { speed: [60, 160], spin: 10, gravity: 220, life: [0.8, 1.2] })], sound: "coin" },
      win: { burst: [e("flake", ["#ffd75e", "#fff0b3", "#c09226"], 30, { speed: [80, 200], spin: 12, gravity: 240, life: [1, 1.6] })], ring: [ring("#ffe0a1", 150, { glow: true, width: 2.5, life: 1.4 })], sound: "coin" },
    },
  },
  "board.deep_sea": {
    lv2: "빛줄기가 내려오고 바다눈과 기포가 떠다녀요", lv3: "부딪힌 자리 주변 플랑크톤이 빛나고 기포가 올라가요",
    react: {
      hold: { burst: [e("bubble", ["#a9fff6"], 2, { speed: [5, 15], gravity: -50 })] },
      grand: { burst: [e("glow", ["#74e7dc", "#a9fff6", "#c6a3ff"], 14, { speed: [20, 70], glow: true, size: [3, 6], life: [1, 1.5] })], ring: [ring("#a9fff6", 120, { width: 2, glow: true, life: 1.3 })], sound: "whoosh" },
      win: { burst: [e("glow", ["#74e7dc", "#a9fff6", "#c6a3ff"], 26, { speed: [30, 110], glow: true, size: [3, 7], life: [1.3, 2] }), e("bubble", ["#ffffff"], 10, { speed: [20, 60], gravity: -60 })], sound: "whoosh" },
    },
  },
  /* ---------------- nature & element collection (2026-11-27) ---------------- */
  "board.storm": {
    lv2: "비가 내리고 먹구름 속에서 마른번개가 번쩍여요", lv3: "부딪힌 자리에서 세기만큼 번개가 갈라져 방전돼요",
    react: {
      land: { sound: "zap" },
      hold: { burst: [e("spark", ["#e6eeff"], 3, { speed: [30, 70], glow: true, life: [0.15, 0.3] })] },
      grand: { lines: [{ kind: "arc", color: "#ffffff", n: 7, length: 150, life: 0.5, width: 2.2, glow: true }], ring: [ring("#a9c6ff", 120, { width: 2.5, glow: true, life: 0.8 })], sound: "zap" },
      win: { lines: [{ kind: "arc", color: "#ffffff", n: 10, length: 200, life: 0.6, width: 2.5, glow: true }], burst: [e("spark", ["#ffffff", "#a9c6ff"], 20, { speed: [80, 220], glow: true, life: [0.3, 0.6] })], sound: "zap" },
    },
  },
  "board.meadow": {
    lv2: "보드 가득한 풀이 바람결에 물결쳐요", lv3: "부딪힌 자리의 풀이 눕고 다시 일어나요",
    react: {
      hold: { burst: [e("glow", ["#f4ffd6"], 2, { speed: [10, 25] })] },
      grand: { burst: [e("petal", ["#ffe36b", "#ffffff", "#ffb3c8"], 14, { speed: [40, 120], spin: 6, gravity: -10, life: [0.9, 1.4] })], sound: "whoosh" },
      win: { burst: [e("petal", ["#ffe36b", "#ffffff", "#ffb3c8", "#b7e07c"], 24, { speed: [50, 160], spin: 6, gravity: -14, life: [1.1, 1.7] })], sound: "chime" },
    },
  },
  "board.flower_field": {
    lv2: "꽃들이 흔들리고 꽃가루가 날려요", lv3: "멈춘 자리에 꽃이 피고 부딪힌 주변 꽃이 흔들려요",
    react: {
      hold: { burst: [e("flower", ["#ffb3c8"], 1, { speed: [5, 10], life: [0.5, 0.7], size: [4, 6] })] },
      grand: { burst: [e("flower", ["#ff8fb0", "#ffd36b", "#c9a0ff"], 10, { speed: [40, 120], spin: 2, life: [0.9, 1.3], size: [5, 8] })], sound: "chime" },
      win: { burst: [e("petal", ["#ff8fb0", "#ffd36b", "#ffffff", "#c9a0ff"], 30, { speed: [50, 170], spin: 6, gravity: 20, life: [1.2, 1.8] })], sound: "bell" },
    },
  },
  "board.sakura": {
    lv2: "꽃잎이 흩날리다 바닥에 내려앉아요", lv3: "부딪히면 바닥의 꽃잎이 세기만큼 흩어져요",
    react: {
      hold: { burst: [e("petal", ["#ffe3ea"], 2, { speed: [10, 25], spin: 4 })] },
      grand: { burst: [e("petal", ["#ffc4d6", "#ffffff", "#ff9fba"], 20, { speed: [60, 160], spin: 7, life: [1, 1.5], drag: 0.4 })], sound: "chime" },
      win: { burst: [e("petal", ["#ffc4d6", "#ffffff", "#ff9fba"], 34, { speed: [60, 190], spin: 7, gravity: 25, life: [1.4, 2] })], sound: "bell" },
    },
  },
  "board.forest": {
    lv2: "나뭇잎 사이 햇살이 흔들리고 반딧불이가 날아다녀요", lv3: "착지한 자리에 새싹이 돋고 빛이 퍼지며 반딧불이가 흩어져요",
    react: {
      hold: { burst: [e("glow", ["#eaff9e"], 2, { speed: [8, 20], glow: true })] },
      grand: { burst: [e("glow", ["#eaff9e", "#fff6b0"], 16, { speed: [20, 80], glow: true, gravity: -20, life: [1.2, 1.8], size: [2, 3.5] })], sound: "chime" },
      win: { burst: [e("glow", ["#eaff9e", "#fff6b0"], 26, { speed: [30, 120], glow: true, gravity: -25, life: [1.4, 2.2], size: [2, 4] }), e("leaf", ["#6fae6a", "#a9dd67", "#d0b15a"], 12, { speed: [60, 150], spin: 6, gravity: 40 })], sound: "bell" },
    },
  },
  "board.volcano": {
    lv2: "균열을 따라 용암이 흐르고 불씨가 올라가요", lv3: "부딪힌 자리가 갈라져 하얗게 달아올랐다 식어요",
    react: {
      land: { sound: "fire" },
      hold: { burst: [e("ember", ["#ffb067"], 2, { speed: [15, 30], glow: true })] },
      grand: { burst: [e("flame", ["#ff6a1a", "#ffb067", "#ffe0a8"], 14, { speed: [80, 200], gravity: 220, glow: true, life: [0.6, 1] })], lines: [{ kind: "crack", color: "#ff7a2a", n: 8, length: 90, life: 1.3, width: 1.8, glow: true }], sound: "fire" },
      win: { burst: [e("flame", ["#ff6a1a", "#ffb067", "#ffe0a8"], 24, { speed: [100, 240], gravity: 240, glow: true, life: [0.7, 1.2] }), e("smoke", ["#4a2a20"], 8, { speed: [20, 50], grow: 2.5, alpha: 0.3, size: [8, 12], life: [1, 1.5] })], sound: "fire" },
    },
  },
};

export const boardFx = (id: string | undefined | null): BoardFxProfile | null => (id ? BOARD_FX[id] ?? null : null);

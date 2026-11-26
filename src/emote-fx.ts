import type { Emitter } from "./dice3d/dice-fx";

/**
 * Emote animations and effects (2026-11-26): one design per emote, meaning first.
 *  Lv.1  the emoji (a short pop-in only).
 *  Lv.2  its own motion (`anim`, a CSS keyframe in emote-fx.css) — never a plain grow/shrink loop.
 *  Lv.3  the motion plus particles (`burst`, drawn around the emoji for ~1.5 s, then freed) and a
 *        dedicated synthesized sound (`voice`, src/sound.ts).
 * The sender's level comes from the server-validated look, so every screen (opponent, spectators)
 * shows the same thing; "상대 아이템 효과" off shows other players' emotes at Lv.1 without sound.
 */
export type EmoteFx = { anim: string; burst?: Emitter[]; voice: string };


const p = (shape: Emitter["shape"], colors: string[], n: number, o: Partial<Emitter> = {}): Emitter => ({ shape, colors, n, speed: [30, 70], life: [0.5, 0.9], size: [2.5, 5], ...o });
const confetti = ["#ff6b6b", "#ffd43b", "#4dabf7", "#69db7c", "#f783ac", "#9775fa"];

export const EMOTE_FX: Record<string, EmoteFx> = {
  "emote.smile": { anim: "tilt", voice: "smile", burst: [p("heart", ["#ffb3c6", "#ffd6e0"], 4, { gravity: -40, speed: [15, 35] })] },
  "emote.party": { anim: "popper", voice: "party", burst: [p("chip", confetti, 16, { speed: [60, 140], gravity: 160, spin: 9 })] },
  "emote.clap": { anim: "clap", voice: "clap", burst: [p("spark", ["#ffe066", "#ffffff"], 8, { speed: [60, 110], life: [0.25, 0.4], glow: true })] },
  "emote.thumbs_up": { anim: "thumb", voice: "thumb", burst: [p("star", ["#ffd43b", "#ffffff"], 6, { speed: [40, 80], glow: true })] },
  "emote.laugh": { anim: "laugh", voice: "laugh", burst: [p("drop", ["#74c0fc", "#a5d8ff"], 8, { speed: [50, 90], gravity: 240, life: [0.4, 0.7] })] },
  "emote.wow": { anim: "gape", voice: "wow", burst: [p("dot", ["#ffffff", "#ffe066"], 6, { speed: [50, 100], life: [0.3, 0.5] })] },
  "emote.cry": { anim: "sob", voice: "cry", burst: [p("drop", ["#4dabf7", "#a5d8ff"], 10, { speed: [10, 30], gravity: 260, life: [0.6, 0.9] })] },
  "emote.handshake": { anim: "handshake", voice: "handshake", burst: [p("star", ["#ffd8a8", "#ffffff"], 6, { speed: [40, 80], glow: true })] },
  "emote.fire": { anim: "flicker", voice: "fire", burst: [p("flame", ["#ff922b", "#ffd43b", "#fa5252"], 10, { gravity: -140, speed: [10, 40], life: [0.4, 0.7], size: [4, 7], glow: true }), p("ember", ["#ffd43b"], 6, { gravity: -90, speed: [20, 50], glow: true })] },
  "emote.dice": { anim: "tumble", voice: "dice", burst: [p("chip", ["#ffffff", "#dee2e6"], 6, { speed: [50, 100], gravity: 220, spin: 8, size: [4, 6] })] },
  "emote.sparkles": { anim: "twinkle", voice: "sparkles", burst: [p("star", ["#fff3bf", "#ffffff", "#ffd43b"], 12, { speed: [30, 90], glow: true })] },
  "emote.crown": { anim: "crown", voice: "crown", burst: [p("star", ["#ffd43b", "#fff3bf"], 10, { speed: [40, 90], glow: true }), p("flake", ["#fcc419"], 6, { speed: [40, 90], gravity: 200, spin: 10 })] },
  "emote.cool": { anim: "cool", voice: "cool", burst: [p("star", ["#ffffff"], 3, { speed: [10, 25], glow: true, size: [4, 7] })] },
  "emote.think": { anim: "ponder", voice: "think", burst: [p("bubble", ["#adb5bd", "#dee2e6"], 4, { gravity: -60, speed: [10, 20], size: [2, 5], life: [0.8, 1.1] })] },
  "emote.sweat": { anim: "nervous", voice: "sweat", burst: [p("drop", ["#74c0fc"], 4, { speed: [20, 40], gravity: 200, life: [0.5, 0.8] })] },
  "emote.please": { anim: "bow", voice: "please", burst: [p("glow", ["#fff3bf"], 5, { speed: [10, 30], gravity: -30, glow: true, size: [4, 7] })] },
  "emote.sleepy": { anim: "doze", voice: "sleepy", burst: [p("note", ["#adb5bd"], 3, { gravity: -40, speed: [10, 20], life: [1, 1.4], size: [3, 4] })] },
  "emote.yay": { anim: "hop", voice: "yay", burst: [p("chip", confetti, 14, { speed: [60, 130], gravity: 180, spin: 9 })] },
  "emote.fired_up": { anim: "huff", voice: "fired_up", burst: [p("smoke", ["#e9ecef", "#ffffff"], 6, { speed: [40, 70], life: [0.4, 0.6], grow: 2, alpha: 0.7, size: [3, 5] })] },
  "emote.clover": { anim: "pinwheel", voice: "clover", burst: [p("leaf", ["#51cf66", "#94d82d"], 8, { speed: [40, 80], spin: 6, gravity: 60 })] },
  "emote.target": { anim: "bullseye", voice: "target", burst: [p("spark", ["#fa5252", "#ffffff"], 8, { speed: [70, 120], life: [0.2, 0.35], glow: true })] },
  "emote.hundred": { anim: "stamp", voice: "hundred", burst: [p("chip", ["#fa5252", "#ff8787"], 8, { speed: [60, 110], gravity: 200, spin: 8 })] },
  "emote.rocket": { anim: "launch", voice: "rocket", burst: [p("smoke", ["#dee2e6", "#f1f3f5"], 8, { speed: [20, 50], life: [0.5, 0.8], grow: 2.2, alpha: 0.6, size: [3, 6] }), p("flame", ["#ff922b", "#ffd43b"], 6, { gravity: 120, speed: [10, 30], glow: true })] },
  "emote.rainbow": { anim: "arc", voice: "rainbow", burst: [p("star", confetti, 10, { speed: [30, 80], glow: true, hue: true })] },
  "emote.whale": { anim: "swim", voice: "whale", burst: [p("drop", ["#74c0fc", "#d0ebff"], 10, { speed: [40, 90], gravity: 200 }), p("bubble", ["#d0ebff"], 4, { gravity: -50 })] },
  "emote.bolt": { anim: "strike", voice: "bolt", burst: [p("spark", ["#ffe066", "#ffffff", "#74c0fc"], 10, { speed: [80, 150], life: [0.15, 0.3], glow: true })] },
  "emote.cake": { anim: "jelly", voice: "cake", burst: [p("chip", ["#ffc9c9", "#fff3bf", "#ffffff"], 8, { speed: [40, 90], gravity: 200, spin: 6, size: [2, 4] })] },
  "emote.gem": { anim: "gem", voice: "gem", burst: [p("prism", ["#99e9f2", "#d0bfff", "#ffffff"], 10, { speed: [40, 90], spin: 6, glow: true, hue: true })] },
  "emote.trophy": { anim: "raise", voice: "trophy", burst: [p("star", ["#ffd43b", "#ffffff"], 8, { speed: [40, 90], glow: true }), p("chip", confetti, 10, { speed: [60, 120], gravity: 180, spin: 8 })] },
  "emote.starlight": { anim: "starpulse", voice: "starlight", burst: [p("star", ["#fff3bf", "#ffffff", "#ffd43b", "#d0bfff"], 16, { speed: [40, 110], glow: true, life: [0.6, 1.1] })] },
  "emote.angry": { anim: "tremble", voice: "angry", burst: [p("smoke", ["#ffffff", "#e9ecef"], 5, { gravity: -80, speed: [20, 40], grow: 2, alpha: 0.6 })] },
  "emote.rage": { anim: "rage", voice: "rage", burst: [p("smoke", ["#ffffff", "#ffc9c9"], 8, { gravity: -110, speed: [30, 60], grow: 2.4, alpha: 0.7, size: [3, 6] }), p("spark", ["#fa5252"], 6, { speed: [60, 110], life: [0.2, 0.3], glow: true })] },
  "emote.question": { anim: "query", voice: "question" },
  "emote.double_question": { anim: "query2", voice: "question2", burst: [p("dot", ["#ced4da"], 4, { speed: [20, 40] })] },
  "emote.exclaim": { anim: "alert", voice: "exclaim" },
  "emote.double_exclaim": { anim: "alert2", voice: "exclaim2", burst: [p("spark", ["#fa5252", "#ffffff"], 6, { speed: [60, 110], life: [0.2, 0.35], glow: true })] },
  "emote.interrobang": { anim: "interro", voice: "interrobang", burst: [p("spark", ["#ffd43b", "#ffffff"], 6, { speed: [60, 110], life: [0.2, 0.35], glow: true })] },
  "emote.smirk": { anim: "smirk", voice: "smirk", burst: [p("star", ["#ffffff"], 2, { speed: [5, 15], glow: true, size: [4, 6] })] },
  "emote.confident": { anim: "swagger", voice: "confident", burst: [p("star", ["#ffd43b", "#ffffff"], 6, { speed: [30, 70], glow: true })] },
  "emote.gasp": { anim: "gasp", voice: "gasp", burst: [p("dot", ["#ffffff"], 6, { speed: [60, 110], life: [0.25, 0.4] })] },
  "emote.christmas_gift": { anim: "gift", voice: "gift", burst: [p("chip", ["#e03131", "#2f9e44", "#ffd43b", "#ffffff"], 14, { speed: [60, 130], gravity: 170, spin: 9 }), p("star", ["#ffd43b"], 4, { glow: true })] },
};

export const emoteFx = (id: string): EmoteFx | null => EMOTE_FX[id] ?? null;

/** What Lv.2 / Lv.3 add, per emote (shop level comparison). */
export const EMOTE_LEVEL_TEXT: Record<string, [string, string]> = {
  "emote.smile": ["고개를 갸웃하며 웃어요", "작은 하트와 맑은 두 음"],
  "emote.party": ["폭죽을 터뜨리듯 기울여요", "색종이가 터지고 팡파르"],
  "emote.clap": ["손뼉을 여러 번 쳐요", "박수 소리와 반짝임"],
  "emote.thumbs_up": ["엄지를 힘차게 들어 올려요", "별빛과 경쾌한 효과음"],
  "emote.laugh": ["몸을 흔들며 웃어요", "눈물이 튀고 하하 웃음소리"],
  "emote.wow": ["입을 쩍 벌려요", "반짝임과 올라가는 감탄음"],
  "emote.cry": ["흐느끼며 들썩여요", "눈물이 흘러내리고 우는 소리"],
  "emote.handshake": ["손을 맞잡고 흔들어요", "반짝임과 따뜻한 화음"],
  "emote.fire": ["불꽃처럼 일렁여요", "불길과 불티, 타오르는 소리"],
  "emote.dice": ["굴러 들어와 멈춰요", "주사위 조각과 굴림 소리"],
  "emote.sparkles": ["반짝이며 돌아요", "별가루가 흩어지는 소리"],
  "emote.crown": ["머리 위로 내려앉아요", "금빛 조각과 왕관 팡파르"],
  "emote.cool": ["여유 있게 고개를 까딱해요", "렌즈 반짝임"],
  "emote.think": ["턱을 괴고 고민해요", "생각 방울과 낮은 허밍"],
  "emote.sweat": ["머쓱하게 흔들려요", "땀방울과 멋쩍은 소리"],
  "emote.please": ["공손히 고개를 숙여요", "따뜻한 빛과 부탁하는 음"],
  "emote.sleepy": ["꾸벅꾸벅 졸아요", "음표가 떠오르고 하품 소리"],
  "emote.yay": ["펄쩍 뛰며 한 바퀴 돌아요", "색종이와 신나는 환호"],
  "emote.fired_up": ["콧김을 뿜으며 부풀어요", "김이 뿜어지는 소리"],
  "emote.clover": ["바람개비처럼 돌아요", "잎사귀와 행운의 음"],
  "emote.target": ["날아와 정중앙에 꽂혀요", "명중 불꽃과 꽂히는 소리"],
  "emote.hundred": ["도장처럼 쾅 찍혀요", "조각이 튀고 쾅 소리"],
  "emote.rocket": ["진동하다 하늘로 발사돼요", "연기와 불꽃, 발사음"],
  "emote.rainbow": ["무지개가 그려져요", "반짝임과 무지개 음계"],
  "emote.whale": ["헤엄치며 물을 뿜어요", "물보라와 고래 울음"],
  "emote.bolt": ["번쩍 내리꽂혀요", "전기 불꽃과 천둥"],
  "emote.cake": ["말랑하게 흔들려요", "부스러기와 달콤한 소리"],
  "emote.gem": ["빛을 받으며 회전해요", "프리즘 조각과 맑은 울림"],
  "emote.trophy": ["번쩍 들어 올려요", "색종이와 시상식 팡파르"],
  "emote.starlight": ["빛나며 회전해요", "별빛이 쏟아지는 소리"],
  "emote.angry": ["부들부들 떨어요", "김이 나고 으르렁"],
  "emote.rage": ["격하게 흔들리며 달아올라요", "증기와 불꽃, 분노의 소리"],
  "emote.question": ["고개를 갸웃해요", "물음표 소리"],
  "emote.double_question": ["좌우로 갸웃거려요", "두 번 묻는 소리"],
  "emote.exclaim": ["깜짝 튀어 올라요", "알림 소리"],
  "emote.double_exclaim": ["두 번 튀어 올라요", "번쩍임과 두 번 알림"],
  "emote.interrobang": ["어리둥절하게 돌아요", "번쩍임과 놀란 소리"],
  "emote.smirk": ["슬쩍 곁눈질해요", "피식 웃는 소리"],
  "emote.confident": ["턱을 들고 으쓱해요", "반짝임과 자신감 있는 음"],
  "emote.gasp": ["움찔했다가 놀라요", "숨 들이켜는 소리"],
  "emote.christmas_gift": ["흔들리다 뚜껑이 열려요", "리본 조각과 선물 여는 소리"],
};

/**
 * Economy v2 candidate set and simulated player types — RESEARCH ONLY. None of these candidates is
 * approved; numbers are study points, not proposals for config.ts.
 */
import { baselineParams, scaleMatch, uniformTiers, type BoosterModel, type PricedTier, type V2Params } from "./params";
import type { Persona, PlayMode } from "./sim";

type Patch = Partial<Omit<V2Params, "id" | "label" | "group">>;
const B = baselineParams();
export const cand = (id: string, group: string, label: string, patch: Patch | ((b: V2Params) => Patch)): V2Params => {
  const base = baselineParams();
  return { ...base, ...(typeof patch === "function" ? patch(base) : patch), id, group, label };
};
const tiers = (c: number, r: number, e: number, l: number, m: number): Record<PricedTier, number> => ({ common: c, rare: r, epic: e, legendary: l, mythic: m });
const q = (b: V2Params, dm: number, wm: number): V2Params["quests"] => ({
  ...b.quests,
  dailyCoins: b.quests.dailyCoins.map((x) => Math.round(x * dm)) as unknown as V2Params["quests"]["dailyCoins"],
  dailyAllBonus: { coins: Math.round(b.quests.dailyAllBonus.coins * dm), gems: b.quests.dailyAllBonus.gems },
  weeklyCoins: b.quests.weeklyCoins.map((x) => Math.round(x * wm)) as unknown as V2Params["quests"]["weeklyCoins"],
  weeklyAllBonus: { coins: Math.round(b.quests.weeklyAllBonus.coins * wm), gems: b.quests.weeklyAllBonus.gems },
});
const STREAK_D = { thresholds: [3, 5, 8], coins: [15, 30, 50] };
const STARTER = { firstPurchaseDiscountPct: 50, maxTier: "rare" as PricedTier, freeDraws: 3 };

/* ------------------------------------------------------------ single factors ------------------------------------------------------------ */
export const SINGLE: V2Params[] = [
  { ...B },
  ...[1.5, 2, 2.5, 3].map((m) => cand(`M${m * 10}`, "경기 보상 배율", `경기 보상 ×${m}`, (b) => ({ match: scaleMatch(b, m) }))),
  cand("D15", "일일 구간", "전액 15경기·감소 40경기까지", (b) => ({ daily: { ...b.daily, fullMatches: 15, reducedUntil: 40 } })),
  cand("D5", "일일 구간", "감소 구간 3→5코인", (b) => ({ daily: { ...b.daily, reducedCoins: 5 } })),
  cand("D20", "일일 구간", "전액 20경기·감소 40경기 5코인", (b) => ({ daily: { ...b.daily, fullMatches: 20, reducedUntil: 40, reducedCoins: 5 } })),
  ...[0.85, 0.7, 0.5].map((m) => cand(`P${m * 100}`, "상품 가격", `상품 가격 ${m * 100}%`, { priceMult: uniformTiers(m) })),
  cand("PLOW", "상품 가격", "일반·고급 50%, 영웅 75%, 전설·신화 100%", { priceMult: tiers(0.5, 0.5, 0.75, 1, 1) }),
  cand("U75", "강화 비용", "강화 비용 75%", { upgradeMult: uniformTiers(0.75) }),
  cand("U50", "강화 비용", "강화 비용 50%", { upgradeMult: uniformTiers(0.5) }),
  cand("ULOW", "강화 비용", "일반·고급 50%, 영웅 70%, 전설·신화 100%", { upgradeMult: tiers(0.5, 0.5, 0.7, 1, 1) }),
  cand("N500", "신규 사용자", "가입 500코인·보석 30, 7일 +10", (b) => ({ newUser: { ...b.newUser, coins: 500, gems: 30, boostPerMatch: 10 } })),
  cand("NSTART", "신규 사용자", "첫 구매 50%(고급 이하)·무료 뽑기 3회", { starter: STARTER }),
  cand("N14", "신규 사용자", "신규 보너스 14일 +10", (b) => ({ newUser: { ...b.newUser, boostDays: 14, boostPerMatch: 10 } })),
  cand("QD2", "퀘스트·업적", "일일 퀘스트 ×2", (b) => ({ quests: q(b, 2, 1) })),
  cand("QW15", "퀘스트·업적", "주간 퀘스트 ×1.5", (b) => ({ quests: q(b, 1, 1.5) })),
  cand("A15", "퀘스트·업적", "업적 ×1.5", { achievementMult: 1.5 }),
  cand("QALL", "퀘스트·업적", "일일·주간·업적 ×1.5", (b) => ({ quests: q(b, 1.5, 1.5), achievementMult: 1.5 })),
  cand("G150", "뽑기", "뽑기 150코인", (b) => ({ draw: { ...b.draw, cost: 150 } })),
  cand("GDUP", "뽑기", "중복 보상 25→75", (b) => ({ draw: { ...b.draw, duplicateCoins: 75 } })),
  cand("G10", "뽑기", "하루 10회", (b) => ({ draw: { ...b.draw, dailyLimit: 10 } })),
  cand("STRK", "연승·컬렉션", "주간 최고 연승 3·5·8 → 15·30·50", { streakWeekly: STREAK_D }),
  cand("COLL", "연승·컬렉션", "컬렉션 완성 300코인·보석 10", { collectionReward: { coins: 300, gems: 10 } }),
  cand("TIER1", "등급 재분류", "확정 주사위·이모티콘 재분류(가격 자동)", { tierMap: "confirmed" }),
  cand("TIER2", "등급 재분류", "확정 + 보드 제안 매핑(가격 자동)", { tierMap: "confirmed+proposed" }),
];

/* --------------------------------------------------------------- policies --------------------------------------------------------------- */
export const POLICIES: V2Params[] = [
  cand("V2-CONS", "정책안", "보수형", (b) => ({
    match: scaleMatch(b, 1.5),
    quests: q(b, 1.5, 1),
    priceMult: tiers(0.7, 0.8, 1, 1, 1),
    starter: STARTER,
  })),
  cand("V2-BAL", "정책안", "균형형", (b) => ({
    match: scaleMatch(b, 2),
    daily: { ...b.daily, reducedCoins: 5 },
    quests: q(b, 1.5, 1.25),
    priceMult: tiers(0.6, 0.7, 0.85, 1, 1),
    upgradeMult: tiers(0.6, 0.6, 0.8, 1, 1),
    draw: { ...b.draw, duplicateCoins: 50 },
    starter: STARTER,
    streakWeekly: STREAK_D,
    collectionReward: { coins: 300, gems: 10 },
  })),
  cand("V2-EXP", "정책안", "보상 확대형", (b) => ({
    match: scaleMatch(b, 2.5),
    daily: { ...b.daily, fullMatches: 15, reducedUntil: 40, reducedCoins: 5 },
    quests: q(b, 2, 1.5),
    achievementMult: 1.5,
    priceMult: tiers(0.5, 0.5, 0.75, 0.85, 1),
    upgradeMult: tiers(0.5, 0.5, 0.6, 0.8, 1),
    draw: { ...b.draw, duplicateCoins: 75, dailyLimit: 10 },
    starter: STARTER,
    streakWeekly: STREAK_D,
    collectionReward: { coins: 300, gems: 10 },
  })),
];

/** Interaction grid: match multiplier × uniform price multiplier. */
export const INTERACTION: V2Params[] = [1, 1.5, 2, 2.5, 3].flatMap((m) =>
  [1, 0.85, 0.7, 0.5].map((pm) => cand(`X-M${m * 10}-P${pm * 100}`, "상호작용", `경기 ×${m} · 가격 ${pm * 100}%`, (b) => ({ match: scaleMatch(b, m), priceMult: uniformTiers(pm) }))),
);

/* ---------------------------------------------------------------- boosters ---------------------------------------------------------------- */
const CAP = 150;
export const BOOSTERS: { id: string; label: string; booster: BoosterModel }[] = [
  { id: "none", label: "미도입", booster: { kind: "none" } },
  ...[10, 15, 30, 60].flatMap((min) => [1.5, 2].map((mult) => ({ id: `time${min}x${mult}`, label: `시간제 ${min}분 ×${mult}`, booster: { kind: "time", minutes: min, mult, perDay: 1, dailyExtraCap: CAP } as BoosterModel }))),
  { id: "match3x2", label: "경기 횟수제 3경기 ×2", booster: { kind: "matches", matches: 3, mult: 2, perDay: 1, dailyExtraCap: CAP } },
  { id: "match5x15", label: "경기 횟수제 5경기 ×1.5", booster: { kind: "matches", matches: 5, mult: 1.5, perDay: 1, dailyExtraCap: CAP } },
  { id: "extra60", label: "추가 획득량제 +60코인(×2)", booster: { kind: "extra", extraCoins: 60, mult: 2, perDay: 1, dailyExtraCap: CAP } },
  { id: "auto3x2", label: "자동 적용 하루 첫 3경기 ×2", booster: { kind: "auto", matches: 3, mult: 2, dailyExtraCap: CAP } },
  { id: "event", label: "서버 이벤트 금~일 20–22시 ×2", booster: { kind: "event", startHour: 20, endHour: 22, weekdays: [5, 6, 0], mult: 2, dailyExtraCap: CAP } },
  { id: "coupon", label: "대체: 무료 뽑기 1/일 + 주 1회 30% 할인", booster: { kind: "coupon", freeDrawsPerDay: 1, discountPct: 30, discountPerWeek: 1 } },
];

/* ---------------------------------------------------------------- personas ---------------------------------------------------------------- */
export const PLAYTIMES = [15, 30, 60, 120, 240, 480] as const;
const MM: Record<PlayMode, number> = { random: 9, friend: 10, ai: 7, offline: 6, solo: 4 };
export const DEFAULT_PERSONA: Omit<Persona, "id" | "minutesPerDay"> = {
  activeProb: 1,
  startHour: 20,
  skill: "intermediate",
  winRate: { random: 0.5, friend: 0.5, ai: 0.55 },
  matchMinutes: MM,
  modeMix: { random: 0.5, friend: 0.1, ai: 0.25, offline: 0.15 },
  queue: { meanWaitSec: 45, patienceSec: 120, fallback: "ai" },
  opponentPool: 30,
  ownForfeit: 0.03,
  oppForfeit: 0.04,
  questFocus: 0.7,
  spend: "spender",
  want: { common: 0.6, rare: 0.5, epic: 0.45, legendary: 0.4, mythic: 0.4 },
  drawAppetite: 0.3,
};
export const persona = (minutes: number, patch: Partial<Persona> = {}, id?: string): Persona => ({
  ...DEFAULT_PERSONA,
  ...patch,
  minutesPerDay: minutes,
  startHour: patch.startHour ?? (minutes >= 240 ? 14 : 20),
  id: id ?? `t${minutes}`,
});
export const MAIN_PERSONAS: Persona[] = PLAYTIMES.map((m) => persona(m));

/** Sensitivity variants (applied to the 60- and 240-minute players). */
export const SENSITIVITY: { id: string; label: string; patch: Partial<Persona> }[] = [
  { id: "default", label: "기본 가정", patch: {} },
  { id: "wr35", label: "승률 35%", patch: { winRate: { random: 0.35, friend: 0.35, ai: 0.4 } } },
  { id: "wr65", label: "승률 65%", patch: { winRate: { random: 0.65, friend: 0.65, ai: 0.7 } } },
  { id: "len6", label: "경기 6분(빠름)", patch: { matchMinutes: { random: 6, friend: 7, ai: 5, offline: 4, solo: 3 } } },
  { id: "len13", label: "경기 13분(느림)", patch: { matchMinutes: { random: 13, friend: 14, ai: 10, offline: 9, solo: 6 } } },
  { id: "len15", label: "경기 15분(인수인계 예시)", patch: { matchMinutes: { random: 15, friend: 15, ai: 15, offline: 15, solo: 8 } } },
  { id: "randomOnly", label: "빠른 대전만", patch: { modeMix: { random: 1 } } },
  { id: "aiHeavy", label: "서버 AI 위주", patch: { modeMix: { ai: 0.8, random: 0.2 } } },
  { id: "offlineHeavy", label: "오프라인 AI·1인 위주(70%)", patch: { modeMix: { offline: 0.5, solo: 0.2, random: 0.2, ai: 0.1 } } },
  { id: "lowTraffic", label: "저트래픽(대기 평균 5분, 2분 후 오프라인)", patch: { queue: { meanWaitSec: 300, patienceSec: 120, fallback: "offline" } } },
  { id: "smallPool", label: "상대 풀 3명(동일 상대 제한)", patch: { opponentPool: 3, modeMix: { random: 1 } } },
  { id: "noQuest", label: "퀘스트 관리 안 함", patch: { questFocus: 0 } },
  { id: "beginner", label: "입문 실력", patch: { skill: "beginner" } },
  { id: "expert", label: "전문가 실력", patch: { skill: "expert" } },
  { id: "saver", label: "저축형 소비", patch: { spend: "saver" } },
  { id: "upgrader", label: "강화형 소비", patch: { spend: "upgrader" } },
  { id: "drawer", label: "뽑기형 소비", patch: { spend: "drawer" } },
  { id: "collector", label: "수집형 소비", patch: { spend: "collector" } },
  { id: "casualDays", label: "주 3일 접속", patch: { activeProb: 3 / 7 } },
];

/** Population mix for concentration metrics (assumption; shares of players by daily play time). */
export const POPULATION: { minutes: number; share: number; activeProb: number }[] = [
  { minutes: 15, share: 0.3, activeProb: 0.3 },
  { minutes: 30, share: 0.25, activeProb: 0.45 },
  { minutes: 60, share: 0.2, activeProb: 0.6 },
  { minutes: 120, share: 0.13, activeProb: 0.7 },
  { minutes: 240, share: 0.08, activeProb: 0.8 },
  { minutes: 480, share: 0.04, activeProb: 0.9 },
];

/** Bot / farming personas (abuse incentives). */
export const ABUSE: Persona[] = [
  persona(1440, { modeMix: { ai: 1 }, matchMinutes: { ...MM, ai: 4.5 }, winRate: { random: 0.5, friend: 0.5, ai: 0.6 }, questFocus: 1, spend: "saver", startHour: 0 }, "bot-ai-24h"),
  persona(1440, { modeMix: { random: 1 }, matchMinutes: { ...MM, random: 8 }, queue: { meanWaitSec: 30, patienceSec: 600, fallback: "ai" }, questFocus: 1, spend: "saver", startHour: 0 }, "bot-random-24h"),
  persona(1440, { modeMix: { friend: 1 }, matchMinutes: { ...MM, friend: 4 }, winRate: { random: 0.5, friend: 0.5, ai: 0.5 }, questFocus: 1, spend: "saver", startHour: 0 }, "bot-friend-trade"),
];

/** New research points. Existing ids retain the definitions above. */
export const AUDIT_CANDIDATES = [
  ...[0.5, 0.6, 0.7, 0.8].flatMap((common) => [0.55, 0.7, 0.85].map((rare) =>
    cand(`C1-A${Math.round(common * 100)}-${Math.round(rare * 100)}`, "가격 단독 탐색", "일반·고급 가격만", {
      priceMult: tiers(common, rare, 1, 1, 1),
    }))),
  cand("C1-SAFE", "보수 개선", "일반 70%, 고급 80%", { priceMult: tiers(0.7, 0.8, 1, 1, 1) }),
  cand("C1-PRICE", "가격 최적화", "일반 55%, 고급 70%, 영웅 90%", { priceMult: tiers(0.55, 0.7, 0.9, 1, 1) }),
  cand("C1-PRICE-R", "가격과 확정 재분류", "가격 우선과 확정 재분류", { priceMult: tiers(0.55, 0.7, 0.9, 1, 1), tierMap: "confirmed" }),
  cand("C1-QUEST", "가격과 일일 퀘스트", "가격 우선과 일일 ×1.25", (b) => ({
    priceMult: tiers(0.55, 0.7, 0.9, 1, 1), quests: q(b, 1.25, 1),
  })),
  cand("C1-QUEST-MIX", "가격과 일일·주간 퀘스트", "일일 ×1.5, 주간 ×1.25, 경기 ×1.1, 첫 할인", (b) => ({
    priceMult: tiers(0.55, 0.7, 0.9, 1, 1), quests: q(b, 1.5, 1.25), match: scaleMatch(b, 1.1),
    starter: { ...STARTER, freeDraws: 0 },
  })),
  cand("C1-LOOP", "획득과 강화", "가격 우선과 일반·고급 강화 비용 조정", {
    priceMult: tiers(0.55, 0.7, 0.9, 1, 1), upgradeMult: tiers(0.65, 0.75, 1, 1, 1),
    secondUpgradeMult: tiers(0.8, 0.9, 1, 1, 1),
  }),
  cand("C1-LONG", "수집과 장기 목표", "컬렉션·연승·업적·신규 할인 및 1회 무료 뽑기", {
    priceMult: tiers(0.65, 0.8, 1, 1, 1), streakWeekly: STREAK_D, achievementMult: 1.1,
    collectionReward: { coins: 150, gems: 5 }, starter: { firstPurchaseDiscountPct: 25, maxTier: "rare", freeDraws: 1 },
  }),
  cand("C1-COMBO", "가격·확정 재분류·강화", "가격 우선·확정 재분류·하위 강화·퀘스트", (b) => ({
    priceMult: tiers(0.55, 0.7, 0.9, 1, 1), upgradeMult: tiers(0.65, 0.75, 1, 1, 1), tierMap: "confirmed",
    secondUpgradeMult: tiers(0.8, 0.9, 1, 1, 1), quests: q(b, 1.25, 1),
  })),
];

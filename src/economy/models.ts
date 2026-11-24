/**
 * Candidate economy models (research only). Coin amounts are in an abstract unit; the experiment
 * runner normalizes coin faucets so a reference user earns the same median per day in every model,
 * which makes models comparable by *shape* (who earns how much, abuse, inflation) rather than scale.
 */
export type Mode = "online_random" | "online_friend" | "server_ai" | "local_ai" | "local_pvp";
export const MODES: Mode[] = ["online_random", "online_friend", "server_ai", "local_ai", "local_pvp"];
export const MODE_LABEL: Record<Mode, string> = {
  online_random: "온라인 무작위", online_friend: "친구 대전", server_ai: "서버 검증 AI", local_ai: "로컬 AI", local_pvp: "로컬 2인",
};
/** Trust level of each mode's record (D-028): only server-verified records may grant official currency. */
export const MODE_TRUST: Record<Mode, "server-verified" | "client-reported"> = {
  online_random: "server-verified", online_friend: "server-verified", server_ai: "server-verified", local_ai: "client-reported", local_pvp: "client-reported",
};
export type ModeReward = { complete: number; win: number; draw: number; quests: boolean; achievements: boolean };
export type EconomyModel = {
  id: string;
  label: string;
  summary: string;
  counterfactual?: boolean;
  match: Record<Mode, ModeReward>;
  /** Full match coins for the first N reward-eligible matches per day, then `afterSoftCap` multiplier. */
  softCapMatches: number;
  afterSoftCap: number;
  /** Integer operation: fixed coins per match after the soft cap (replaces the multiplier when set). */
  afterSoftCapFlat?: number;
  /** Integer operation: flat bonus per full-reward match during the new-user boost / events (replaces multipliers). */
  boostPerMatch?: number;
  eventPerMatch?: number;
  /** Reward-eligible matches per day that can earn match coins at all (after it: 0 match coins; quests/achievements still count). */
  dailyRewardedMatchLimit: number;
  /** Matches per day that advance cumulative achievements (anti-bot; quests are not limited). */
  achievementDailyMatchLimit: number;
  /** Hard cap on match coins per day (null = none). */
  dailyMatchCoinCap: number | null;
  /** Reward-eligible friend matches per day (anti win-trading). */
  friendDailyLimit: number;
  quests: {
    dailyCoins: [number, number, number]; dailyGems: [number, number, number]; dailyAllBonus: { coins: number; gems: number };
    weeklyCoins: [number, number, number]; weeklyGems: [number, number, number]; weeklyAllBonus: { coins: number; gems: number };
    monthly: null | { coins: number; gems: number; needDailyDays: number };
  };
  achievementGemScale: number;
  achievementCoinPerGem: number;
  newUser: { coins: number; gems: number; boostDays: number; boostMultiplier: number };
  /** Special events: every N days, L days long; match coins multiplier and a one-time event reward if ≥k matches. */
  events: { everyDays: number; lengthDays: number; coinMultiplier: number; rewardGems: number; rewardCoins: number; minMatches: number };
  /** Server-verified guest matches credited on account link (days, 0 = none). Candidate policy, not decided. */
  guestCarryoverDays: number;
  /** Cap on carried-over guest matches (undefined = no cap). */
  guestCarryoverMatchCap?: number;
};
const pvp = (complete: number, win: number, draw: number): ModeReward => ({ complete, win, draw, quests: true, achievements: true });
const none: ModeReward = { complete: 0, win: 0, draw: 0, quests: false, achievements: false };
const baseQuests = {
  dailyCoins: [20, 30, 40] as [number, number, number], dailyGems: [0, 0, 0] as [number, number, number], dailyAllBonus: { coins: 20, gems: 1 },
  weeklyCoins: [100, 150, 200] as [number, number, number], weeklyGems: [2, 3, 5] as [number, number, number], weeklyAllBonus: { coins: 100, gems: 5 },
  monthly: null,
};
const baseEvents = { everyDays: 42, lengthDays: 7, coinMultiplier: 1.5, rewardGems: 10, rewardCoins: 200, minMatches: 10 };

export const MODELS: EconomyModel[] = [
  {
    id: "M0", label: "M0 단순 신뢰(반례)", counterfactual: true,
    summary: "모든 모드(로컬 AI 포함 클라이언트 기록)에 보상, 상한 없음. 어뷰징 위험을 측정하기 위한 반례 — 채택 후보 아님.",
    match: { online_random: pvp(15, 10, 5), online_friend: pvp(15, 10, 5), server_ai: pvp(15, 10, 5), local_ai: pvp(15, 10, 5), local_pvp: pvp(15, 10, 5) },
    softCapMatches: 1e9, afterSoftCap: 1, dailyRewardedMatchLimit: 1e9, achievementDailyMatchLimit: 1e9, dailyMatchCoinCap: null, friendDailyLimit: 1e9,
    quests: baseQuests, achievementGemScale: 1, achievementCoinPerGem: 10,
    newUser: { coins: 300, gems: 20, boostDays: 0, boostMultiplier: 1 }, events: baseEvents, guestCarryoverDays: 1e9,
  },
  {
    id: "M1", label: "M1 경기 중심",
    summary: "경기 보상이 주 수급원(완료+승리), 퀘스트는 작게, 상한 없음. 많이 할수록 선형으로 더 받음.",
    match: { online_random: pvp(30, 20, 10), online_friend: { ...pvp(30, 0, 0) }, server_ai: pvp(20, 10, 5), local_ai: none, local_pvp: none },
    softCapMatches: 1e9, afterSoftCap: 1, dailyRewardedMatchLimit: 1e9, achievementDailyMatchLimit: 1e9, dailyMatchCoinCap: null, friendDailyLimit: 10,
    quests: { ...baseQuests, dailyCoins: [10, 15, 20], weeklyCoins: [50, 75, 100], weeklyAllBonus: { coins: 50, gems: 5 } },
    achievementGemScale: 1, achievementCoinPerGem: 10,
    newUser: { coins: 300, gems: 20, boostDays: 0, boostMultiplier: 1 }, events: baseEvents, guestCarryoverDays: 0,
  },
  {
    id: "M2", label: "M2 퀘스트 중심",
    summary: "경기당 보상은 작고 일일·주간 퀘스트가 주 수급원. 하루 소수 경기로 대부분 획득.",
    match: { online_random: pvp(5, 5, 2), online_friend: pvp(5, 0, 0), server_ai: pvp(3, 2, 1), local_ai: none, local_pvp: none },
    softCapMatches: 1e9, afterSoftCap: 1, dailyRewardedMatchLimit: 1e9, achievementDailyMatchLimit: 1e9, dailyMatchCoinCap: null, friendDailyLimit: 10,
    quests: { ...baseQuests, dailyCoins: [50, 80, 110], dailyAllBonus: { coins: 60, gems: 1 }, weeklyCoins: [250, 350, 450], weeklyAllBonus: { coins: 300, gems: 5 } },
    achievementGemScale: 1, achievementCoinPerGem: 10,
    newUser: { coins: 300, gems: 20, boostDays: 0, boostMultiplier: 1 }, events: baseEvents, guestCarryoverDays: 0,
  },
  {
    id: "M3", label: "M3 혼합·소프트캡",
    summary: "경기 보상 + 퀘스트 균형, 하루 10경기 이후 경기 코인 25%, 30경기 이후 경기 코인 0(퀘스트는 계속, 업적 진행은 하루 40경기까지). 친구 대전은 승리 보상 없음·일 10경기.",
    match: { online_random: pvp(15, 10, 5), online_friend: pvp(15, 0, 0), server_ai: pvp(10, 5, 2), local_ai: none, local_pvp: none },
    softCapMatches: 10, afterSoftCap: 0.25, dailyRewardedMatchLimit: 30, achievementDailyMatchLimit: 40, dailyMatchCoinCap: null, friendDailyLimit: 10,
    quests: baseQuests, achievementGemScale: 1, achievementCoinPerGem: 10,
    newUser: { coins: 300, gems: 20, boostDays: 7, boostMultiplier: 1.5 }, events: baseEvents, guestCarryoverDays: 7,
  },
  {
    id: "M4", label: "M4 하드캡",
    summary: "M3와 같으나 경기 코인 하루 상한(소프트캡 없음). 상한 이후 경기 코인 0.",
    match: { online_random: pvp(15, 10, 5), online_friend: pvp(15, 0, 0), server_ai: pvp(10, 5, 2), local_ai: none, local_pvp: none },
    softCapMatches: 1e9, afterSoftCap: 1, dailyRewardedMatchLimit: 1e9, achievementDailyMatchLimit: 40, dailyMatchCoinCap: 200, friendDailyLimit: 10,
    quests: baseQuests, achievementGemScale: 1, achievementCoinPerGem: 10,
    newUser: { coins: 300, gems: 20, boostDays: 7, boostMultiplier: 1.5 }, events: baseEvents, guestCarryoverDays: 7,
  },
  {
    id: "M5", label: "M5 보석 확대",
    summary: "M3 + 일일 보석·주간 보석·업적 보석 2배. 보석 희소성 유지 여부를 시험.",
    match: { online_random: pvp(15, 10, 5), online_friend: pvp(15, 0, 0), server_ai: pvp(10, 5, 2), local_ai: none, local_pvp: none },
    softCapMatches: 10, afterSoftCap: 0.25, dailyRewardedMatchLimit: 30, achievementDailyMatchLimit: 40, dailyMatchCoinCap: null, friendDailyLimit: 10,
    quests: { ...baseQuests, dailyGems: [1, 1, 2], dailyAllBonus: { coins: 20, gems: 3 }, weeklyGems: [5, 8, 12], weeklyAllBonus: { coins: 100, gems: 15 } },
    achievementGemScale: 2, achievementCoinPerGem: 10,
    newUser: { coins: 300, gems: 50, boostDays: 7, boostMultiplier: 1.5 }, events: { ...baseEvents, rewardGems: 30 }, guestCarryoverDays: 7,
  },
  {
    id: "M6", label: "M6 혼합+월간 도전",
    summary: "M3 + 월간 도전(한 달에 일일 퀘스트를 15일 이상 완료 시 보석·코인). 장기 복귀 동기 시험.",
    match: { online_random: pvp(15, 10, 5), online_friend: pvp(15, 0, 0), server_ai: pvp(10, 5, 2), local_ai: none, local_pvp: none },
    softCapMatches: 10, afterSoftCap: 0.25, dailyRewardedMatchLimit: 30, achievementDailyMatchLimit: 40, dailyMatchCoinCap: null, friendDailyLimit: 10,
    quests: { ...baseQuests, monthly: { coins: 400, gems: 20, needDailyDays: 15 } },
    achievementGemScale: 1, achievementCoinPerGem: 10,
    newUser: { coins: 300, gems: 20, boostDays: 7, boostMultiplier: 1.5 }, events: baseEvents, guestCarryoverDays: 7,
  },
];
export const modelById = (id: string) => MODELS.find((m) => m.id === id)!;

/** Scale all coin faucets of a model (used for normalization). Gems are not scaled. */
export function scaleCoins(m: EconomyModel, k: number): EconomyModel {
  const r = (x: number) => Math.round(x * k);
  const match = Object.fromEntries(Object.entries(m.match).map(([mode, v]) => [mode, { ...v, complete: v.complete * k, win: v.win * k, draw: v.draw * k }])) as Record<Mode, ModeReward>;
  return {
    ...m,
    match,
    dailyMatchCoinCap: m.dailyMatchCoinCap === null ? null : m.dailyMatchCoinCap * k,
    quests: {
      ...m.quests,
      dailyCoins: m.quests.dailyCoins.map(r) as [number, number, number], dailyAllBonus: { ...m.quests.dailyAllBonus, coins: r(m.quests.dailyAllBonus.coins) },
      weeklyCoins: m.quests.weeklyCoins.map(r) as [number, number, number], weeklyAllBonus: { ...m.quests.weeklyAllBonus, coins: r(m.quests.weeklyAllBonus.coins) },
      monthly: m.quests.monthly && { ...m.quests.monthly, coins: r(m.quests.monthly.coins) },
    },
    achievementCoinPerGem: m.achievementCoinPerGem * k,
    newUser: { ...m.newUser, coins: r(m.newUser.coins) },
    events: { ...m.events, rewardCoins: r(m.events.rewardCoins) },
  };
}

/**
 * Integer operating version of M3 (follow-up study): completion = 10 coins, every amount an integer.
 * `winPct` = win bonus as a share of the completion reward (phase-1 M3 was 10/15 ≈ 67%).
 */
export function integerM3(winPct: number, extra: Partial<EconomyModel> = {}): EconomyModel {
  const win = Math.round(10 * winPct);
  const draw = Math.ceil(win / 2);
  const aiWin = Math.max(win > 0 ? 1 : 0, Math.round(win / 2));
  const base = MODELS.find((m) => m.id === "M3")!;
  return {
    ...base,
    id: `M3i-W${Math.round(winPct * 100)}`,
    label: `M3 정수안 · 승리 +${win} (${Math.round(winPct * 100)}%)`,
    summary: `완료 10 · 승리 +${win} · 무승부 +${draw}(무작위 대전), 친구 완료 10, 서버 AI 완료 7 · 승리 +${aiWin}. 10경기 이후 경기당 3, 30경기 이후 0. 신규 7일·이벤트 기간 경기당 +5.`,
    match: { online_random: { complete: 10, win, draw, quests: true, achievements: true }, online_friend: { complete: 10, win: 0, draw: 0, quests: true, achievements: true }, server_ai: { complete: 7, win: aiWin, draw: 0, quests: true, achievements: true }, local_ai: { complete: 0, win: 0, draw: 0, quests: false, achievements: false }, local_pvp: { complete: 0, win: 0, draw: 0, quests: false, achievements: false } },
    softCapMatches: 10, afterSoftCap: 0.3, afterSoftCapFlat: 3, dailyRewardedMatchLimit: 30, achievementDailyMatchLimit: 40, dailyMatchCoinCap: null, friendDailyLimit: 10,
    quests: { dailyCoins: [15, 20, 30], dailyGems: [0, 0, 0], dailyAllBonus: { coins: 15, gems: 1 }, weeklyCoins: [70, 100, 130], weeklyGems: [2, 3, 5], weeklyAllBonus: { coins: 70, gems: 5 }, monthly: null },
    achievementGemScale: 1, achievementCoinPerGem: 7,
    newUser: { coins: 200, gems: 20, boostDays: 7, boostMultiplier: 1 }, boostPerMatch: 5,
    events: { everyDays: 42, lengthDays: 7, coinMultiplier: 1, rewardGems: 10, rewardCoins: 150, minMatches: 10 }, eventPerMatch: 5,
    guestCarryoverDays: 0,
    ...extra,
  };
}
export const INTEGER_MODELS: EconomyModel[] = [0.67, 0.3, 0.2, 0.1].map((w) => integerM3(w));

/**
 * User archetypes for the economy simulator. ALL numbers are assumptions (no real user data yet);
 * the experiment runner varies the important ones in a sensitivity analysis.
 */
import type { TierId } from "./content";
import type { Mode } from "./models";

export type SpendStyle = "spender" | "collector" | "saver" | "upgrader" | "focus" | "none";
export type AbuseKind = "none" | "bot_server_ai" | "win_trade_friend" | "forge_local" | "multi_account";
export type Persona = {
  id: string;
  label: string;
  /** Probability of playing on a given day. */
  activeDayProb: number;
  /** Matches per active day: negative binomial (mean, shape). */
  matchesMean: number;
  matchesShape: number;
  minutesPerMatch: number;
  tier: Partial<Record<TierId, number>>;
  modeMix: Partial<Record<Mode, number>>;
  /** Share of users of this type who are logged in (guests get no official currency). */
  loggedInShare: number;
  /** Plays up to 3 extra matches to finish unfinished daily quests. */
  questChaser: boolean;
  spend: SpendStyle;
  /** Probability of wanting an item when it is released, by rarity index (common..mythic). */
  wantByRarity: [number, number, number, number, number];
  upgradeAppetite: number; // 0..1
  /** Share of every earning reserved for the current legendary/mythic goal item (saver = 1). */
  goalShare: number;
  /** Focus spenders: buy the target mythic with coins (default) or gems. */
  focusCurrency?: "coin" | "gem";
  payer: null | { monthlyPurchaseProb: number; coinsPerPurchase: number; gemsPerPurchase: number };
  abuse: AbuseKind;
  /** Population: lifetime days ~ lognormal(median, sigma) and arrival share. */
  lifetimeMedianDays: number;
  lifetimeSigma: number;
  arrivalShare: number;
};
const T = (b: number, c: number, i: number, s: number, e: number) => ({ beginner: b, casual: c, intermediate: i, strong: s, expert: e });
const pvpMix = { online_random: 0.55, online_friend: 0.15, server_ai: 0.2, local_ai: 0.1 };

export const PERSONAS: Persona[] = [
  { id: "occasional", label: "비정기 사용자", activeDayProb: 0.12, matchesMean: 2.5, matchesShape: 2, minutesPerMatch: 7, tier: T(0.4, 0.4, 0.2, 0, 0), modeMix: { online_random: 0.35, online_friend: 0.25, server_ai: 0.15, local_ai: 0.25 }, loggedInShare: 0.4, questChaser: false, spend: "spender", wantByRarity: [0.3, 0.2, 0.1, 0.05, 0.05], upgradeAppetite: 0.1, goalShare: 0.2, payer: null, abuse: "none", lifetimeMedianDays: 6, lifetimeSigma: 1.2, arrivalShare: 0.34 },
  { id: "light", label: "라이트 유저", activeDayProb: 0.35, matchesMean: 3, matchesShape: 2, minutesPerMatch: 7, tier: T(0.2, 0.4, 0.3, 0.1, 0), modeMix: pvpMix, loggedInShare: 0.7, questChaser: false, spend: "spender", wantByRarity: [0.4, 0.3, 0.2, 0.1, 0.1], upgradeAppetite: 0.2, goalShare: 0.3, payer: null, abuse: "none", lifetimeMedianDays: 15, lifetimeSigma: 1.1, arrivalShare: 0.25 },
  { id: "regular", label: "일반 유저", activeDayProb: 0.65, matchesMean: 6, matchesShape: 2.5, minutesPerMatch: 7, tier: T(0.05, 0.25, 0.45, 0.2, 0.05), modeMix: pvpMix, loggedInShare: 0.9, questChaser: true, spend: "spender", wantByRarity: [0.5, 0.4, 0.3, 0.25, 0.3], upgradeAppetite: 0.4, goalShare: 0.5, payer: null, abuse: "none", lifetimeMedianDays: 60, lifetimeSigma: 1.0, arrivalShare: 0.16 },
  { id: "heavy", label: "헤비 유저", activeDayProb: 0.9, matchesMean: 15, matchesShape: 3, minutesPerMatch: 7, tier: T(0, 0.1, 0.35, 0.4, 0.15), modeMix: pvpMix, loggedInShare: 1, questChaser: true, spend: "upgrader", wantByRarity: [0.5, 0.5, 0.5, 0.5, 0.6], upgradeAppetite: 0.8, goalShare: 0.5, payer: null, abuse: "none", lifetimeMedianDays: 150, lifetimeSigma: 0.9, arrivalShare: 0.07 },
  { id: "extreme", label: "극단적 헤비 유저", activeDayProb: 0.98, matchesMean: 40, matchesShape: 4, minutesPerMatch: 6.5, tier: T(0, 0, 0.2, 0.5, 0.3), modeMix: { online_random: 0.6, online_friend: 0.05, server_ai: 0.3, local_ai: 0.05 }, loggedInShare: 1, questChaser: true, spend: "upgrader", wantByRarity: [0.6, 0.6, 0.6, 0.7, 0.8], upgradeAppetite: 1, goalShare: 0.5, payer: null, abuse: "none", lifetimeMedianDays: 240, lifetimeSigma: 0.8, arrivalShare: 0.01 },
  { id: "collector", label: "수집형 사용자", activeDayProb: 0.75, matchesMean: 8, matchesShape: 2.5, minutesPerMatch: 7, tier: T(0.05, 0.25, 0.4, 0.25, 0.05), modeMix: pvpMix, loggedInShare: 1, questChaser: true, spend: "collector", wantByRarity: [1, 1, 1, 1, 1], upgradeAppetite: 0.1, goalShare: 0.2, payer: null, abuse: "none", lifetimeMedianDays: 150, lifetimeSigma: 0.9, arrivalShare: 0.04 },
  { id: "saver", label: "저축형 사용자", activeDayProb: 0.65, matchesMean: 6, matchesShape: 2.5, minutesPerMatch: 7, tier: T(0.05, 0.25, 0.45, 0.2, 0.05), modeMix: pvpMix, loggedInShare: 1, questChaser: true, spend: "saver", wantByRarity: [0.2, 0.2, 0.3, 0.5, 1], upgradeAppetite: 0.2, goalShare: 1, payer: null, abuse: "none", lifetimeMedianDays: 90, lifetimeSigma: 0.9, arrivalShare: 0.04 },
  { id: "small_payer", label: "소액 결제 사용자", activeDayProb: 0.7, matchesMean: 7, matchesShape: 2.5, minutesPerMatch: 7, tier: T(0.05, 0.25, 0.4, 0.25, 0.05), modeMix: pvpMix, loggedInShare: 1, questChaser: true, spend: "spender", wantByRarity: [0.5, 0.5, 0.5, 0.5, 0.5], upgradeAppetite: 0.5, goalShare: 0.4, payer: { monthlyPurchaseProb: 0.5, coinsPerPurchase: 0, gemsPerPurchase: 100 }, abuse: "none", lifetimeMedianDays: 120, lifetimeSigma: 0.9, arrivalShare: 0.04 },
  { id: "big_payer", label: "고액 결제 사용자", activeDayProb: 0.85, matchesMean: 10, matchesShape: 3, minutesPerMatch: 7, tier: T(0, 0.2, 0.4, 0.3, 0.1), modeMix: pvpMix, loggedInShare: 1, questChaser: true, spend: "collector", wantByRarity: [1, 1, 1, 1, 1], upgradeAppetite: 1, goalShare: 0.3, payer: { monthlyPurchaseProb: 0.9, coinsPerPurchase: 20000, gemsPerPurchase: 1500 }, abuse: "none", lifetimeMedianDays: 200, lifetimeSigma: 0.8, arrivalShare: 0.005 },
  { id: "abuser", label: "어뷰징 사용자(서버 AI 봇)", activeDayProb: 1, matchesMean: 300, matchesShape: 50, minutesPerMatch: 4.5, tier: T(0, 0, 0, 0, 1), modeMix: { server_ai: 1 }, loggedInShare: 1, questChaser: false, spend: "saver", wantByRarity: [0, 0, 0, 0, 1], upgradeAppetite: 0, goalShare: 1, payer: null, abuse: "bot_server_ai", lifetimeMedianDays: 60, lifetimeSigma: 1, arrivalShare: 0.015 },
];
/** Abuse variants evaluated separately (same simulator, different behaviour). */
export const ABUSE_VARIANTS: Persona[] = [
  PERSONAS.find((p) => p.id === "abuser")!,
  { ...PERSONAS.find((p) => p.id === "abuser")!, id: "abuse_win_trade", label: "승리 거래(친구 대전 2계정)", matchesMean: 100, modeMix: { online_friend: 1 }, abuse: "win_trade_friend" },
  { ...PERSONAS.find((p) => p.id === "abuser")!, id: "abuse_forge_local", label: "로컬 AI 기록 위조", matchesMean: 1000, modeMix: { local_ai: 1 }, abuse: "forge_local" },
  { ...PERSONAS.find((p) => p.id === "abuser")!, id: "abuse_random_bot", label: "온라인 무작위 대전 봇(24시간)", matchesMean: 180, modeMix: { online_random: 1 }, minutesPerMatch: 8, abuse: "bot_server_ai" },
];
export const personaById = (id: string) => [...PERSONAS, ...ABUSE_VARIANTS].find((p) => p.id === id)!;

/**
 * Live economy configuration — the operating model `M3i-W30` (docs/economy/ECONOMY-RESEARCH.md §16,
 * DECISIONS D-034/D-035, docs/economy/LIVE-ECONOMY.md). Every amount the server grants or charges is
 * read from this one versioned object; nothing else in the code base hard-codes a reward or a price.
 *
 * Change rules:
 *  - Bump `version` whenever a number changes. Ledger rows store the version they were granted under,
 *    so a later re-calibration can be audited (never rewrite history; grant/deduct with new rows).
 *  - Lowering a reward after launch hurts trust (D-031): prefer adding events/bonuses over cutting.
 *  - Ids of quests, achievements and items are permanent: never reuse an id with another meaning.
 *
 * Shared by the Worker (authoritative) and the web client (display only).
 */
import type { Category } from "../../engine";

export type MatchKind = "random" | "friend" | "ai";
/** The server's day/week boundary: 00:00 KST (UTC+9) for every player, weeks start on Monday. */
export const RESET_OFFSET_MS = 9 * 3600_000;

export type QuestMetric = "play" | "win" | "days" | Category;
export type QuestDef = { id: string; period: "daily" | "weekly"; difficulty: 0 | 1 | 2; label: string; metric: QuestMetric; count: number };
export type AchievementDef = {
  id: string;
  group: "cumulative" | "skill" | "luck" | "special" | "collection";
  label: string;
  /** Counter key in the player's achievement counters (see src/economy/live/rewards.ts `bumpCounters`). */
  key: string;
  count: number;
  gems: number;
  coins: number;
  /** Shown as "???" until unlocked (symbolic, extremely rare). */
  hidden?: boolean;
  /** Achievement-only item granted on unlock (never purchasable). */
  item?: string;
  /** Expected matches for an intermediate player (research), null = not reachable in simulation. */
  expectedMatches: number | null;
};

const ach = (id: string, group: AchievementDef["group"], label: string, key: string, count: number, gems: number, expectedMatches: number | null, extra: Partial<AchievementDef> = {}): AchievementDef => ({
  id,
  group,
  label,
  key,
  count,
  gems,
  // M3i: achievement coins = gems × 7 (`achievementCoinPerGem`), symbolic ones grant no coins.
  coins: extra.hidden ? 0 : gems * 7,
  expectedMatches,
  ...extra,
});

export const ECONOMY = {
  version: "M3i-W30@2",
  model: "M3i-W30",
  /** Per-match coins by mode (completed matches of signed-in players only). */
  match: {
    random: { complete: 10, win: 3, draw: 2 },
    friend: { complete: 10, win: 0, draw: 0 },
    ai: { complete: 7, win: 2, draw: 0 },
  } satisfies Record<MatchKind, { complete: number; win: number; draw: number }>,
  daily: {
    /** 1st..10th rewarded match of the day: full reward (+ boosts). */
    fullMatches: 10,
    /** 11th..30th: a flat amount per match (win/draw bonuses and boosts do not apply). */
    reducedUntil: 30,
    reducedCoins: 3,
    /** Friend matches: at most this many rewarded per day (they still count toward the shared order). */
    friendRewarded: 10,
    /** Random matches against the same signed-in opponent: at most this many rewarded per day. */
    sameOpponentRewarded: 3,
    /** Achievement counters take at most this many matches per day (quests and stats are not capped). */
    achievementMatches: 40,
    /** Server AI matches a player may START per day (abort-to-reroll fishing is bounded by starts). */
    aiStarts: 30,
  },
  /** An opponent's forfeit still pays completion (no win bonus) once I have filled this many categories. */
  forfeitCompletionMinCategories: 6,
  newUser: { coins: 200, gems: 20, boostDays: 7, boostPerMatch: 5 },
  quests: {
    dailyCoins: [15, 20, 30] as const,
    dailyGems: [0, 0, 0] as const,
    dailyAllBonus: { coins: 15, gems: 1 },
    weeklyCoins: [70, 100, 130] as const,
    weeklyGems: [2, 3, 5] as const,
    weeklyAllBonus: { coins: 70, gems: 5 },
    dailyRerolls: 1,
  },
  /**
   * Special events: none at launch. Each entry adds `perMatch` coins to full-reward matches inside
   * [start, end) and pays `reward` once after `minMatches` rewarded matches in the window.
   */
  events: [] as { id: string; label: string; start: number; end: number; perMatch: number; minMatches: number; reward: { coins: number; gems: number } }[],
  /** Account deletion: a re-created account gets no new-user grant for this long (no identity is kept). */
  rejoinWelcomeCooldownMs: 30 * 86_400_000,
} as const;

/* ------------------------------------------------------------------ quests ------------------------------------------------------------------ */
// Final pools (docs/economy/LIVE-ECONOMY.md §퀘스트): beginner expected matches ≤ ~12 per daily quest,
// one quest per difficulty, one free re-roll per day. Score thresholds are achievements, not quests.
export const QUESTS: readonly QuestDef[] = [
  { id: "d.play1", period: "daily", difficulty: 0, label: "경기 1회 완료", metric: "play", count: 1 },
  { id: "d.play3", period: "daily", difficulty: 0, label: "경기 3회 완료", metric: "play", count: 3 },
  { id: "d.full1", period: "daily", difficulty: 0, label: "풀 하우스 기록", metric: "full", count: 1 },
  { id: "d.small1", period: "daily", difficulty: 0, label: "스몰 스트레이트 기록", metric: "small", count: 1 },
  { id: "d.win1", period: "daily", difficulty: 1, label: "1승", metric: "win", count: 1 },
  { id: "d.play5", period: "daily", difficulty: 1, label: "경기 5회 완료", metric: "play", count: 5 },
  { id: "d.large1", period: "daily", difficulty: 1, label: "라지 스트레이트 기록", metric: "large", count: 1 },
  { id: "d.win2", period: "daily", difficulty: 2, label: "2승", metric: "win", count: 2 },
  { id: "d.yacht1", period: "daily", difficulty: 2, label: "요트 기록", metric: "yacht", count: 1 },
  { id: "w.play15", period: "weekly", difficulty: 0, label: "경기 15회 완료", metric: "play", count: 15 },
  { id: "w.days4", period: "weekly", difficulty: 0, label: "4일 플레이", metric: "days", count: 4 },
  { id: "w.full8", period: "weekly", difficulty: 0, label: "풀 하우스 8회", metric: "full", count: 8 },
  { id: "w.win7", period: "weekly", difficulty: 1, label: "7승", metric: "win", count: 7 },
  { id: "w.yacht2", period: "weekly", difficulty: 1, label: "요트 2회", metric: "yacht", count: 2 },
  { id: "w.large8", period: "weekly", difficulty: 1, label: "라지 스트레이트 8회", metric: "large", count: 8 },
  { id: "w.win12", period: "weekly", difficulty: 2, label: "12승", metric: "win", count: 12 },
  { id: "w.yacht4", period: "weekly", difficulty: 2, label: "요트 4회", metric: "yacht", count: 4 },
];
export const questById = (id: string) => QUESTS.find((q) => q.id === id) ?? null;

/* --------------------------------------------------------------- achievements --------------------------------------------------------------- */
// Gems: 1.5·√(expected matches of an intermediate player), rounded, cap 100 (docs/economy/results/achievements.json).
export const ACHIEVEMENTS: readonly AchievementDef[] = [
  ach("a.match.10", "cumulative", "경기 10회 완료", "match", 10, 5, 10),
  ach("a.match.100", "cumulative", "경기 100회 완료", "match", 100, 15, 100),
  ach("a.match.500", "cumulative", "경기 500회 완료", "match", 500, 30, 500),
  ach("a.match.1000", "cumulative", "경기 1000회 완료", "match", 1000, 50, 1000),
  ach("a.win.10", "cumulative", "10승", "win", 10, 5, 20),
  ach("a.win.100", "cumulative", "100승", "win", 100, 20, 200),
  ach("a.win.500", "cumulative", "500승", "win", 500, 50, 1000),
  ach("a.yacht.1", "cumulative", "요트 1회", "yacht", 1, 5, 5.2),
  ach("a.yacht.10", "cumulative", "요트 10회", "yacht", 10, 10, 52),
  ach("a.yacht.50", "cumulative", "요트 50회", "yacht", 50, 20, 260),
  ach("a.yacht.200", "cumulative", "요트 200회", "yacht", 200, 50, 1039),
  ach("a.large.10", "cumulative", "라지 스트레이트 10회", "large", 10, 5, 13),
  ach("a.large.100", "cumulative", "라지 스트레이트 100회", "large", 100, 15, 130),
  ach("a.full.10", "cumulative", "풀 하우스 10회", "full", 10, 5, 13),
  ach("a.full.100", "cumulative", "풀 하우스 100회", "full", 100, 15, 130),
  ach("s.200", "skill", "200점 이상 달성", "best", 200, 5, 5.3),
  ach("s.250", "skill", "250점 이상 달성", "best", 250, 10, 62),
  ach("s.270", "skill", "270점 이상 달성", "best", 270, 30, 370),
  ach("s.200x25", "skill", "200점 이상 25회", "t200", 25, 15, 133),
  ach("s.nozero", "skill", "0점 칸 없이 경기 완료", "noZero", 1, 10, 39),
  ach("s.comeback", "skill", "9라운드 후 30점 이상 뒤지다 역전승", "comeback30", 1, 10, 46),
  ach("s.streak5", "skill", "무작위 대전 5연승", "streak", 5, 10, 62),
  ach("s.streak10", "skill", "무작위 대전 10연승", "streak", 10, 70, 2046),
  ach("l.firstyacht", "luck", "첫 굴림 요트", "firstRollYacht", 1, 15, 116),
  ach("l.sixes30", "luck", "헥사 30점(6 다섯 개)", "sixes30", 1, 15, 84),
  ach("l.finalyacht", "luck", "마지막 라운드 요트", "finalRoundYacht", 1, 50, 1212),
  ach("l.firstlarge10", "luck", "첫 굴림 라지 스트레이트 10회", "firstRollLarge", 10, 10, 27),
  ach("c.yachtfaces", "collection", "1~6 모든 눈으로 요트", "yachtFaces", 6, 15, 90),
  ach("c.days.7", "collection", "7일 플레이", "days", 7, 10, 42),
  ach("c.days.30", "collection", "30일 플레이", "days", 30, 20, 180),
  ach("c.days.100", "collection", "100일 플레이", "days", 100, 40, 600),
  ach("c.dq.30", "collection", "일일 퀘스트 30회 완료", "dailyQuests", 30, 30, 375),
  ach("c.items.3", "collection", "아이템 3개 보유", "items", 3, 10, null),
  ach("c.items.10", "collection", "아이템 10개 보유", "items", 10, 20, null),
  // Symbolic (special tier): achievement-only titles, hidden until unlocked, gems only.
  ach("x.firstyacht2", "special", "한 경기 첫 굴림 요트 2회", "firstRollYacht2", 1, 100, 25580, { hidden: true, item: "title.lucky_star" }),
  ach("x.300", "special", "300점 이상", "best", 300, 100, null, { hidden: true, item: "title.300" }),
  ach("x.310", "special", "310점 이상", "best", 310, 100, null, { hidden: true, item: "title.310" }),
  ach("x.perfect", "special", "323점 완벽한 경기", "best", 323, 100, null, { hidden: true, item: "title.perfect" }),
];
export const achievementById = (id: string) => ACHIEVEMENTS.find((a) => a.id === id) ?? null;

/* ------------------------------------------------------------- prices / upgrades ------------------------------------------------------------- */
export type TierId = "basic" | "common" | "rare" | "epic" | "legendary" | "mythic" | "special";
export const TIERS: readonly { id: TierId; label: string }[] = [
  { id: "basic", label: "기본" },
  { id: "common", label: "일반" },
  { id: "rare", label: "고급" },
  { id: "epic", label: "영웅" },
  { id: "legendary", label: "전설" },
  { id: "mythic", label: "신화" },
  { id: "special", label: "특수" },
];
/** Default list prices per tier (an item may override). Special-tier prices are decided per item. */
export const TIER_PRICES: Record<Exclude<TierId, "special">, { coins: number; gems: number }> = {
  basic: { coins: 0, gems: 0 },
  common: { coins: 300, gems: 40 },
  rare: { coins: 1000, gems: 120 },
  epic: { coins: 3000, gems: 300 },
  legendary: { coins: 10000, gems: 600 },
  mythic: { coins: 25000, gems: 1200 },
};
/** Upgrade cost in coins (always coins, also for items bought with gems): Lv1→2, Lv2→3 (ratio 1 : 0.5 : 1). */
export const UPGRADE_COINS: Record<Exclude<TierId, "special" | "basic">, [number, number]> = {
  common: [150, 300],
  rare: [500, 1000],
  epic: [1500, 3000],
  legendary: [5000, 10000],
  mythic: [12000, 25000],
};
export const MAX_LEVEL = 3;
/** Equip slots: base and max per kind; the price of the n-th extra slot (coins or gems, buyer's choice). */
export const SLOTS = {
  emote: { base: 4, max: 8 },
  chat: { base: 6, max: 10 },
  prices: [
    { coins: 500, gems: 25 },
    { coins: 1000, gems: 50 },
    { coins: 1500, gems: 80 },
    { coins: 2500, gems: 120 },
  ],
} as const;

/** The economy day (KST) of a time: an integer, also the key of daily quests. */
export const economyDay = (t: number) => Math.floor((t + RESET_OFFSET_MS) / 86_400_000);
/** Monday-based economy week. Day 0 (1970-01-01) was a Thursday, so +3 aligns weeks to Monday. */
export const economyWeek = (t: number) => Math.floor((economyDay(t) + 3) / 7);
/** Start of the next economy day / week (UTC ms) — for "resets in" labels. */
export const nextDayStart = (t: number) => (economyDay(t) + 1) * 86_400_000 - RESET_OFFSET_MS;
export const nextWeekStart = (t: number) => ((economyWeek(t) + 1) * 7 - 3) * 86_400_000 - RESET_OFFSET_MS;

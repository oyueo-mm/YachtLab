/**
 * Economy study — skill tiers, per-match event probabilities (from real engine games), and the
 * candidate quest / achievement catalog. Research data only: nothing here grants anything in the game.
 */
import matchEvents from "./data/match-events.json";
import exactPmf from "./data/exact-score-pmf.json";
import rare from "./data/rare-events.json";

export type TierId = "beginner" | "casual" | "intermediate" | "strong" | "expert";
export const TIER_IDS: TierId[] = ["beginner", "casual", "intermediate", "strong", "expert"];
export const TIER_LABEL: Record<TierId, string> = { beginner: "입문", casual: "초급", intermediate: "중급", strong: "숙련", expert: "전문가" };

/** Per-match event keys. Count-type keys use the per-match mean as an (almost always 0/1) Bernoulli rate. */
export type EventKey =
  | "match" | "win" | "draw" | "upperBonus" | "upperPerfectPath" | "yachtScored" | "largeScored" | "smallScored" | "fullScored" | "fourScored"
  | "sixesMax" | "choice28" | "noZero" | "comeback30" | "tightWin" | "winBy100"
  | "t150" | "t180" | "t200" | "t220" | "t250" | "t270" | "t290" | "t300" | "t310" | "perfect323"
  | "finalRoundYacht" | "firstRollYacht" | "firstRollYacht2" | "firstRollYacht3" | "largeFirstRoll"
  | "yachtFace1" | "yachtFace2" | "yachtFace3" | "yachtFace4" | "yachtFace5" | "yachtFace6";
export const SIM_EVENT_KEYS: EventKey[] = [
  "upperBonus", "upperPerfectPath", "yachtScored", "largeScored", "smallScored", "fullScored", "fourScored", "sixesMax", "choice28", "noZero",
  "comeback30", "tightWin", "winBy100", "t180", "t200", "t220", "t250", "t270", "finalRoundYacht", "firstRollYacht", "largeFirstRoll",
  "yachtFace1", "yachtFace2", "yachtFace3", "yachtFace4", "yachtFace5", "yachtFace6",
];
type Mirror = (typeof matchEvents.mirror)["expert"];
const mirror = matchEvents.mirror as Record<TierId, Mirror>;
const rareExact = rare.exact;
const tails = exactPmf.tailAtLeast as Record<string, number>;

/** Event probability per match for a tier, measured in same-tier games (win ≈ 0.5); win-linked events scale with `winRate`. */
export function eventProbability(tier: TierId, key: EventKey, winRate = 0.5): number {
  const m = mirror[tier];
  const ev = m.events as Record<string, { p: number }>;
  const counts = m.counts as Record<string, { mean: number }>;
  const winLinked = key === "comeback30" || key === "tightWin" || key === "winBy100";
  if (key === "match") return 1;
  if (key === "win") return winRate;
  if (key.startsWith("yachtFace")) return m.yachtFacePerMatch[Number(key.slice(9)) - 1];
  if (key === "firstRollYacht" || key === "largeFirstRoll") return counts[key].mean; // mean count per match (≪1 for yacht)
  if (key === "firstRollYacht2") return rareExact.firstRollYacht.perGameAtLeast2;
  if (key === "firstRollYacht3") return rareExact.firstRollYacht.perGameAtLeast3;
  // Exact DP Expert tail (upper bound for weaker tiers; used only where Monte Carlo has no hits)
  if (key === "t300") return tier === "expert" ? tails["300"] : tier === "strong" ? tails["300"] * 0.3 : 0;
  if (key === "t310") return tier === "expert" ? tails["310"] : 0;
  if (key === "perfect323") return tier === "expert" ? tails["323"] : 0;
  const p = ev[key]?.p ?? 0;
  return winLinked ? (p * winRate) / Math.max(0.01, ev.win.p) : p;
}

/** Cross-tier score rates (win + 0.5·draw), measured with alternating seats. */
export function crossScoreRate(a: TierId, b: TierId): number {
  if (a === b) return 0.5;
  return (matchEvents.cross as Record<string, Record<string, { scoreRate: number }>>)[a][b].scoreRate;
}

// ---------------- quests ----------------
export type Period = "daily" | "weekly" | "monthly";
export type Difficulty = 0 | 1 | 2; // easy / medium / hard
export type QuestDef = { id: string; period: Period; difficulty: Difficulty; label: string; key: EventKey; count: number };
export const QUESTS: QuestDef[] = [
  { id: "d.play3", period: "daily", difficulty: 0, label: "경기 3회 완료", key: "match", count: 3 },
  { id: "d.full1", period: "daily", difficulty: 0, label: "풀 하우스 1회 기록", key: "fullScored", count: 1 },
  { id: "d.small1", period: "daily", difficulty: 0, label: "스몰 스트레이트 1회 기록", key: "smallScored", count: 1 },
  { id: "d.win1", period: "daily", difficulty: 1, label: "1승", key: "win", count: 1 },
  { id: "d.bonus1", period: "daily", difficulty: 1, label: "상단 보너스 1회 달성", key: "upperBonus", count: 1 },
  { id: "d.large2", period: "daily", difficulty: 1, label: "라지 스트레이트 2회 기록", key: "largeScored", count: 2 },
  { id: "d.180", period: "daily", difficulty: 1, label: "180점 이상 1회", key: "t180", count: 1 },
  { id: "d.win2", period: "daily", difficulty: 2, label: "2승", key: "win", count: 2 },
  { id: "d.200", period: "daily", difficulty: 2, label: "200점 이상 1회", key: "t200", count: 1 },
  { id: "d.yacht1", period: "daily", difficulty: 2, label: "요트 1회 기록", key: "yachtScored", count: 1 },
  { id: "d.four2", period: "daily", difficulty: 2, label: "포커 2회 기록", key: "fourScored", count: 2 },
  { id: "w.play15", period: "weekly", difficulty: 0, label: "경기 15회 완료", key: "match", count: 15 },
  { id: "w.full8", period: "weekly", difficulty: 0, label: "풀 하우스 8회", key: "fullScored", count: 8 },
  { id: "w.win7", period: "weekly", difficulty: 1, label: "7승", key: "win", count: 7 },
  { id: "w.bonus5", period: "weekly", difficulty: 1, label: "상단 보너스 5회", key: "upperBonus", count: 5 },
  { id: "w.yacht2", period: "weekly", difficulty: 1, label: "요트 2회", key: "yachtScored", count: 2 },
  { id: "w.220x2", period: "weekly", difficulty: 2, label: "220점 이상 2회", key: "t220", count: 2 },
  { id: "w.yacht4", period: "weekly", difficulty: 2, label: "요트 4회", key: "yachtScored", count: 4 },
  { id: "w.win12", period: "weekly", difficulty: 2, label: "12승", key: "win", count: 12 },
  { id: "m.play60", period: "monthly", difficulty: 1, label: "경기 60회 완료", key: "match", count: 60 },
  { id: "m.yacht8", period: "monthly", difficulty: 2, label: "요트 8회", key: "yachtScored", count: 8 },
];
/** Rejected quest ideas (policy): kept so the reasoning is visible in the lab and docs. */
export const REJECTED_QUESTS = [
  { label: "N회 패배하기 / 0점 기록하기", reason: "고의 패배·고의 0점(샌드배깅)을 보상 — 상대 경험 훼손, 랭크 오염" },
  { label: "친구와 N경기", reason: "두 계정 담합(승리 거래)의 직접 유인" },
  { label: "이모티콘·채팅 N회 보내기", reason: "도배 유도 — 소셜 속도 제한과 충돌" },
  { label: "N분 안에 경기 끝내기", reason: "빠른 기권·비정상 전략 유도" },
  { label: "접속만 하면 보상(출석)", reason: "실제 플레이 없는 빈 접속 유도, 서버 요청만 증가 — 대신 '경기 1회 완료'로 대체" },
  { label: "상점에서 구매하기 / 강화하기", reason: "소비·과금 유도 퀘스트 금지" },
  { label: "로컬 AI N승", reason: "클라이언트 기록은 조작 가능 — 공식 보상 불가" },
  { label: "특정 칸에 특정 점수(예: 에이스 5점)", reason: "점수 최대화와 반대되는 비정상 전략 유도(상대·AI 비교 왜곡)" },
];

// ---------------- achievements ----------------
export type AchGroup = "cumulative" | "skill" | "luck" | "special" | "collection" | "ranked";
export type AchievementDef = {
  id: string; group: AchGroup; label: string;
  /** Counted event and threshold (cumulative across matches). "streak" uses consecutive server-verified wins. */
  key: EventKey | "streak" | "activeDays" | "yachtFaces" | "dailyQuests";
  count: number;
  /** Symbolic tier items: achievement-only, never purchasable. */
  symbolic?: boolean;
  note?: string;
};
export const ACHIEVEMENTS: AchievementDef[] = [
  ...[10, 100, 500, 1000, 5000, 10000].map((n) => ({ id: `a.match.${n}`, group: "cumulative" as const, label: `경기 ${n}회 완료`, key: "match" as const, count: n })),
  ...[10, 100, 500, 2000].map((n) => ({ id: `a.win.${n}`, group: "cumulative" as const, label: `${n}승`, key: "win" as const, count: n })),
  ...[1, 10, 50, 200, 1000].map((n) => ({ id: `a.yacht.${n}`, group: "cumulative" as const, label: `요트 ${n}회`, key: "yachtScored" as const, count: n })),
  ...[10, 100, 500].map((n) => ({ id: `a.bonus.${n}`, group: "cumulative" as const, label: `상단 보너스 ${n}회`, key: "upperBonus" as const, count: n })),
  { id: "s.200", group: "skill", label: "200점 이상 달성", key: "t200", count: 1 },
  { id: "s.200x25", group: "skill", label: "200점 이상 25회", key: "t200", count: 25 },
  { id: "s.250", group: "skill", label: "250점 이상 달성", key: "t250", count: 1 },
  { id: "s.270", group: "skill", label: "270점 이상 달성", key: "t270", count: 1 },
  { id: "s.nozero", group: "skill", label: "0점 칸 없이 경기 완료", key: "noZero", count: 1 },
  { id: "s.perfectpath", group: "skill", label: "상단 모든 칸 3개 이상(정석 보너스)", key: "upperPerfectPath", count: 1 },
  { id: "s.comeback", group: "skill", label: "9라운드 후 30점 이상 뒤지다 역전승", key: "comeback30", count: 1 },
  { id: "s.streak5", group: "skill", label: "온라인 무작위 대전 5연승", key: "streak", count: 5 },
  { id: "s.streak10", group: "skill", label: "온라인 무작위 대전 10연승", key: "streak", count: 10 },
  { id: "l.firstyacht", group: "luck", label: "첫 굴림 요트", key: "firstRollYacht", count: 1 },
  { id: "l.sixes30", group: "luck", label: "헥사 30점(6 다섯 개)", key: "sixesMax", count: 1 },
  { id: "l.finalyacht", group: "luck", label: "마지막 라운드 요트", key: "finalRoundYacht", count: 1 },
  { id: "l.firstlarge10", group: "luck", label: "첫 굴림 라지 스트레이트 10회", key: "largeFirstRoll", count: 10 },
  { id: "x.firstyacht2", group: "special", label: "한 경기 첫 굴림 요트 2회", key: "firstRollYacht2", count: 1, symbolic: true },
  { id: "x.300", group: "special", label: "300점 이상", key: "t300", count: 1, symbolic: true },
  { id: "x.firstyacht3", group: "special", label: "한 경기 첫 굴림 요트 3회", key: "firstRollYacht3", count: 1, symbolic: true, note: "정확 확률 ≈1.0×10⁻⁷/경기" },
  { id: "x.310", group: "special", label: "310점 이상", key: "t310", count: 1, symbolic: true },
  { id: "x.perfect", group: "special", label: "323점 완벽한 경기", key: "perfect323", count: 1, symbolic: true, note: "DP Expert 4.4×10⁻¹⁶, 목표 최적 3.2×10⁻¹⁴ — 사실상 상징(숨김 권장)" },
  { id: "c.yachtfaces", group: "collection", label: "1~6 모든 눈으로 요트", key: "yachtFaces", count: 6 },
  ...[30, 100, 365, 1000].map((n) => ({ id: `c.days.${n}`, group: "collection" as const, label: `서버 검증 경기를 한 날 ${n}일`, key: "activeDays" as const, count: n })),
  ...[30, 180, 365].map((n) => ({ id: `c.dq.${n}`, group: "collection" as const, label: `일일 퀘스트 ${n}회 완료`, key: "dailyQuests" as const, count: n })),
];
/** Future ranked achievements: analysed analytically only (no ranked mode yet). */
export const RANKED_IDEAS = [
  { label: "시즌 배치 경기 10회 완료", condition: "server-verified 무작위 대전 10경기", difficulty: "쉬움", reward: "칭호(시즌 표기)" },
  { label: "시즌 최고 구간 도달(상위 ~10%)", condition: "레이팅 상위 비율 — 실력 분포 의존", difficulty: "어려움", reward: "시즌 테두리(업적 전용)" },
  { label: "시즌 최상위 1%", condition: "레이팅 상위 1% — 정의상 1%만 가능", difficulty: "극히 어려움", reward: "상징 아이템(구매 불가)" },
  { label: "3시즌 연속 같은 구간 유지", condition: "장기 실력 유지", difficulty: "어려움", reward: "칭호" },
];

/** Difficulty band of an achievement from its expected matches for a reference player. */
export function difficultyBand(expectedMatches: number): { band: string; label: string } {
  if (expectedMatches <= 10) return { band: "E", label: "쉬움" };
  if (expectedMatches <= 100) return { band: "N", label: "보통" };
  if (expectedMatches <= 1000) return { band: "H", label: "어려움" };
  if (expectedMatches <= 10000) return { band: "VH", label: "매우 어려움" };
  if (expectedMatches <= 1e6) return { band: "X", label: "극한" };
  return { band: "S", label: "상징(사실상 불가능)" };
}
/**
 * Achievement gem reward from expected matches for the reference player: concave (1.5·√E, cap 100) so
 * grinding and luck are not over-paid and the lifetime achievement gem pool stays finite and small
 * (first calibration with 5·√E, cap 300 made achievements 72% of all free gems — rejected).
 */
export function achievementGems(expectedMatches: number, scale = 1): number {
  if (!Number.isFinite(expectedMatches)) return 0;
  const raw = 1.5 * Math.sqrt(Math.max(1, expectedMatches)) * scale;
  const capped = Math.min(raw, 100 * scale);
  const nice = capped < 20 ? Math.round(capped / 5) * 5 : capped < 100 ? Math.round(capped / 10) * 10 : Math.round(capped / 50) * 50;
  return Math.max(5, nice);
}

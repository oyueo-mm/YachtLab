/**
 * ADMIN-1 — read-only statistics derived from the counters the service ALREADY keeps (MatchHub daily
 * counters, RoomDirectory usage, AdminHub activity days). Pure functions: no Durable Object walk, no
 * per-account reads. A metric that has never been counted is returned as `null` (shown as "미집계"),
 * never as 0, and each section lists what is not collected at all.
 *
 * Counter names (MatchHub, `hub.count`): see docs/admin/ADMIN-FEEDBACK.md §2.2. Counters added by
 * ADMIN-1 start at its deployment; `firstSeen` tells from which day a counter exists.
 */
export type DayCounters = { day: string } & Record<string, number | string>;
type Sum = Record<string, number>;

const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
function sum(days: DayCounters[], test: (k: string) => boolean): Sum {
  const out: Sum = {};
  for (const d of days) for (const [k, v] of Object.entries(d)) if (k !== "day" && test(k)) out[k] = (out[k] ?? 0) + n(v);
  return out;
}
const has = (days: DayCounters[], prefix: string) => days.some((d) => Object.keys(d).some((k) => k.startsWith(prefix)));
const firstSeen = (days: DayCounters[], prefix: string) => days.find((d) => Object.keys(d).some((k) => k.startsWith(prefix)))?.day ?? null;
const ratio = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 10_000) / 10_000 : null);
const strip = (s: Sum, prefix: string) => Object.fromEntries(Object.entries(s).map(([k, v]) => [k.slice(prefix.length), v]));
const perDay = (days: DayCounters[], keys: string[] | ((k: string) => boolean)) =>
  days.map((d) => ({ day: d.day, value: Object.entries(d).filter(([k]) => k !== "day" && (typeof keys === "function" ? keys(k) : keys.includes(k))).reduce((a, [, v]) => a + n(v), 0) }));

export function matchStats(days: DayCounters[]) {
  const finished = sum(days, (k) => k.startsWith("finished."));
  const byKind: Record<string, { completed: number; forfeit: number; total: number; completionRate: number | null; forfeitRate: number | null; avgDurationSec: number | null }> = {};
  for (const kind of ["random", "friend", "ai"]) {
    const completed = finished[`finished.${kind}.completed`] ?? 0, forfeit = finished[`finished.${kind}.forfeit`] ?? 0;
    const dur = sum(days, (k) => k === `duration.${kind}.totalSec`)[`duration.${kind}.totalSec`] ?? 0;
    byKind[kind] = { completed, forfeit, total: completed + forfeit, completionRate: ratio(completed, completed + forfeit), forfeitRate: ratio(forfeit, completed + forfeit), avgDurationSec: completed ? Math.round(dur / completed) : null };
  }
  const total = Object.values(byKind).reduce((a, k) => a + k.total, 0);
  return {
    total,
    daily: perDay(days, (k) => k.startsWith("finished.")),
    byKind,
    players: has(days, "players.") ? strip(sum(days, (k) => k.startsWith("players.")), "players.") : null,
    playersSince: firstSeen(days, "players."),
    missing: ["경기별 원시 기록(서버는 회원 계정에만 결과 보관, 전체 경기 목록 없음)"],
  };
}

export function matchingStats(days: DayCounters[], now: { waiting?: number; waitMsToday?: { n: number; p50: number | null; p90: number | null } } | null) {
  const s = sum(days, (k) => k.startsWith("queue.") || k.startsWith("match.") || k.startsWith("wait."));
  const joins = s["queue.join"] ?? 0, matched = (s["match.random"] ?? 0) * 2;
  return {
    requests: joins,
    matchedPlayers: matched,
    successRate: ratio(Math.min(matched, joins), joins),
    cancels: s["queue.cancel"] ?? 0,
    cancelRate: ratio(s["queue.cancel"] ?? 0, joins),
    left: s["queue.leave"] ?? 0,
    expired: s["queue.expired"] ?? 0,
    ghosts: s["queue.ghost"] ?? 0,
    failures: s["match.fail"] ?? 0,
    avgWaitMs: s["wait.n"] ? Math.round((s["wait.totalMs"] ?? 0) / s["wait.n"]) : null,
    waitToday: now?.waitMsToday ?? null,
    waitingNow: now?.waiting ?? null,
    daily: days.map((d) => ({ day: d.day, requests: n(d["queue.join"]), matches: n(d["match.random"]) })),
    byHour: has(days, "queue.hour.") ? strip(sum(days, (k) => k.startsWith("queue.hour.")), "queue.hour.") : null,
    byHourSince: firstSeen(days, "queue.hour."),
    missing: ["대기 시간 분위수는 오늘(메모리 표본 500개)만 제공"],
  };
}

export function economyStats(days: DayCounters[]) {
  const s = sum(days, () => true);
  const spendKnown = has(days, "spend.");
  return {
    issued: { coins: s["econ.coins"] ?? 0, gems: s["econ.gems"] ?? 0, welcomeGrants: s["econ.welcome"] ?? 0, adminCoins: has(days, "grant.admin.") ? s["grant.admin.coins"] ?? 0 : null, adminGems: has(days, "grant.admin.") ? s["grant.admin.gems"] ?? 0 : null },
    spent: spendKnown ? { coins: s["spend.coins"] ?? 0, gems: s["spend.gems"] ?? 0 } : null,
    spentSince: firstSeen(days, "spend."),
    daily: days.map((d) => ({ day: d.day, coinsIssued: n(d["econ.coins"]), gemsIssued: n(d["econ.gems"]), coinsSpent: d["spend.coins"] === undefined ? null : n(d["spend.coins"]) })),
    rewardSources: strip(sum(days, (k) => k.startsWith("reward.")), "reward."),
    balanceBuckets: strip(sum(days, (k) => k.startsWith("balance.")), "balance."),
    maxCoinsOneAccountOneDay: Math.max(0, ...days.map((d) => n(d["econ.maxCoinsOneAccount"]))),
    ledgerProblems: has(days, "ledger.problem") ? s["ledger.problem"] ?? 0 : null,
    notes: [
      "보유 잔액 분포는 그날 처음 보상을 받은 회원의 잔액 구간(하루 1회) 표본이며 전체 회원 분포가 아님",
      "원장 이상은 관리자가 회원 상세를 열 때 그 계정의 원장 재합산 결과로 집계",
    ],
  };
}

export function itemStats(days: DayCounters[]) {
  const s = sum(days, () => true);
  return {
    purchasesByTier: strip(sum(days, (k) => k.startsWith("buy.")), "buy."),
    purchasesByItem: has(days, "item.") ? strip(sum(days, (k) => k.startsWith("item.")), "item.") : null,
    upgrades: s["upgrade"] ?? 0,
    upgradeLevels: has(days, "upgrade.level.") ? strip(sum(days, (k) => k.startsWith("upgrade.level.")), "upgrade.level.") : null,
    slots: strip(sum(days, (k) => k.startsWith("slot.")), "slot."),
    draws: s["shop.draw"] ?? 0,
    drawDuplicates: has(days, "draw.duplicate") ? s["draw.duplicate"] ?? 0 : null,
    drawHands: has(days, "draw.hand.") ? strip(sum(days, (k) => k.startsWith("draw.hand.")), "draw.hand.") : null,
    since: firstSeen(days, "item."),
    missing: ["장착률(장착 상태는 각 계정에만 있음)", "컬렉션 보유·완성 현황(계정별 인벤토리 순회가 필요해 미집계)"],
  };
}

export function questStats(days: DayCounters[], dauTotal: number | null) {
  const s = sum(days, () => true);
  return {
    questsDone: s["quest.done"] ?? 0,
    dailyAllDone: s["quest.allDaily"] ?? 0,
    rerolls: s["quest.reroll"] ?? 0,
    achievements: s["achievement.unlock"] ?? 0,
    byQuest: has(days, "quest.id.") ? strip(sum(days, (k) => k.startsWith("quest.id.")), "quest.id.") : null,
    byAchievement: has(days, "achievement.id.") ? strip(sum(days, (k) => k.startsWith("achievement.id.")), "achievement.id.") : null,
    rewardedMembersDays: s["dau.members"] ?? 0,
    dailyAllRate: dauTotal ? ratio(s["quest.allDaily"] ?? 0, dauTotal) : null,
    daily: days.map((d) => ({ day: d.day, done: n(d["quest.done"]), allDaily: n(d["quest.allDaily"]) })),
    since: firstSeen(days, "quest.id."),
    missing: ["퀘스트별 참여(배정) 수 — 완료 수만 집계", "업적별 달성률의 분모(전체 회원 중 달성 비율)는 회원 색인 수로 근사"],
  };
}

export function systemStats(days: DayCounters[]) {
  const s = sum(days, (k) => k.startsWith("worker.") || k.startsWith("account.cleanup."));
  return {
    errors: has(days, "worker.error") ? s["worker.error"] ?? 0 : null,
    errorsSince: firstSeen(days, "worker.error"),
    daily: has(days, "worker.error") ? perDay(days, ["worker.error"]) : null,
    cleanup: strip(sum(days, (k) => k.startsWith("account.cleanup.")), "account.cleanup."),
    missing: ["전체 요청량·CPU·지연(Cloudflare 대시보드의 Workers 분석에서 확인)"],
  };
}

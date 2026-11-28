import { economyDay, economyWeek, nextDayStart, nextWeekStart } from "../../src/economy/live/config";
import type { RewardInput } from "../../src/economy/live/rewards";
import {
  APPROVED_POLICY, applyWeeklyStreak, claimAttendance, dailyPlayEligible, markActiveDay, newRetentionState,
  type Milestone, type RetentionGrant, type RetentionPolicy, type RetentionState,
} from "../../src/economy/retention/policy";
import type { EconSql } from "./economy";
import type { GrantRecord, GrantSource, RewardGrants } from "./grants";

/**
 * C5-CORE retention rewards of ONE account (approved policy, Worker flag `RETENTION`, default off).
 * Runs in the account's SQLite Durable Object next to `EconomyStore` and `RewardGrants`:
 *  - `retention` (one row): attendance cycle, activity streak, weekly best streak (JSON, versioned)
 *  - every payment is a `RewardGrants.issue` (deterministic tx id → the ledger row `g:<txId>`) in the
 *    SAME transaction as the state change, so a state step and its payment are stored together or not at all
 *
 * What counts:
 *  - attendance: an explicit claim, once per KST day (claiming is NOT activity)
 *  - activity: a server-verified match played out to the end (not my forfeit, not an opponent's
 *    forfeit, not over a mode cap), or an approved daily content completion (LIVE-1 official game)
 *  - weekly best streak: server-verified quick (1:1 random) matches only, the policy's rules
 */

export type DailyContentActivity = {
  /** LIVE-1 `DailyActivity.kind`. Only the approved kinds count as activity. */
  kind: string;
  /** Server time of the completion. */
  at: number;
};
/** Daily content kinds that count as activity (owner approval 2026-11-28: "승인된 일일 콘텐츠 완료"). */
export const ACTIVITY_DAILY_KINDS: ReadonlySet<string> = new Set(["daily.official.completed"]);

export type RetentionStatus = {
  enabled: boolean;
  policy: string;
  serverTime: number;
  day: number;
  week: number;
  attendance: { claimedToday: boolean; claimed: number; cycle: number; total: number; rewards: { coins: number; gems: number }[]; nextResetAt: number };
  activity: { current: number; best: number; activeToday: boolean; broken: boolean; restPerWeek: number; restLeft: number; milestones: (Milestone & { paid: boolean })[] };
  weeklyStreak: { current: number; best: number; tiers: { streak: number; coins: number; paid: boolean }[]; paidCoins: number; nextResetAt: number };
};

const SOURCE: Record<RetentionGrant["source"], GrantSource> = {
  attendance: "attendance",
  "daily-play": "daily-play",
  "activity-streak": "activity-streak",
  "weekly-streak": "weekly-streak",
  return: "return",
};

export class RetentionStore {
  constructor(private readonly sql: EconSql, private readonly grants: RewardGrants, private readonly policy: RetentionPolicy = APPROVED_POLICY) {}

  init() {
    this.sql.exec("CREATE TABLE IF NOT EXISTS retention (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL, updated_at INTEGER NOT NULL)");
  }

  private load(): RetentionState {
    const raw = this.sql.exec<{ data: string }>("SELECT data FROM retention WHERE id = 1").toArray()[0]?.data;
    if (!raw) return newRetentionState();
    try {
      const s = JSON.parse(raw) as RetentionState;
      return s?.v === 1 && s.att && s.act && s.ws ? s : newRetentionState();
    } catch {
      return newRetentionState();
    }
  }
  private save(s: RetentionState, now: number) {
    this.sql.exec("INSERT INTO retention (id, data, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at", JSON.stringify(s), now);
  }

  /** Issue the grants of one state step. Called inside the caller's transaction. */
  private pay(userId: string, grants: RetentionGrant[], now: number): GrantRecord[] {
    const out: GrantRecord[] = [];
    for (const g of grants) {
      const r = this.grants.issue(userId, {
        txId: g.txId, source: SOURCE[g.source], coins: g.coins, gems: g.gems, items: g.title ? [g.title] : [], policyVersion: this.policy.version,
        label: g.label, actor: "system", delivery: "direct",
      }, now);
      // Every precondition is checked before any write, so a refusal here leaves nothing behind;
      // it can only mean a corrupt store, and the caller's transaction must not commit half a step.
      if (!r.ok) throw Error(`retention grant refused: ${r.code}`);
      if (!r.duplicate) out.push(r.record);
    }
    return out;
  }

  /** Attendance claim (POST /api/me/rewards/attendance). One per KST day. */
  claimAttendance(userId: string, now: number): { ok: true; granted: GrantRecord[]; status: RetentionStatus } | { ok: false; code: string; message: string } {
    if (!this.policy.attendance) return { ok: false, code: "RETENTION_OFF", message: "출석 보상은 아직 준비 중이에요." };
    const policy = this.policy.attendance;
    return this.sql.transaction(() => {
      const s = this.load();
      const step = claimAttendance(s, policy, now);
      if (step.reason === "already-claimed") return { ok: false as const, code: "ALREADY_CLAIMED", message: "오늘 출석 보상은 이미 받았어요." };
      if (step.reason !== "ok") return { ok: false as const, code: "TRY_LATER", message: "잠시 후 다시 시도해 주세요." };
      const granted = this.pay(userId, step.grants, now);
      this.save(step.state, now);
      return { ok: true as const, granted, status: this.status(now, step.state) };
    });
  }

  /**
   * One server-verified match, inside the match-record transaction (after `EconomyStore.applyMatch`).
   * `countable` / `reason` come from the live settlement of the same match.
   */
  onMatch(userId: string, record: { source: string; verification: string }, input: RewardInput, settled: { countable: boolean; reason: string }, now: number): GrantRecord[] {
    if (record.source !== "server" || record.verification !== "server-verified") return [];
    let s = this.load();
    const grants: RetentionGrant[] = [];
    if (this.policy.activity && dailyPlayEligible(input, settled)) {
      const r = markActiveDay(s, this.policy.activity, input.endedAt);
      s = r.state;
      grants.push(...r.grants);
    }
    if (this.policy.weeklyStreak) {
      const r = applyWeeklyStreak(s, this.policy.weeklyStreak, input);
      s = r.state;
      grants.push(...r.grants);
    }
    const paid = this.pay(userId, grants, now);
    this.save(s, now);
    return paid;
  }

  /** An approved daily content completion (LIVE-1). Marks the day active; daily-content coins stay unapproved. */
  onDailyContent(userId: string, activity: DailyContentActivity, now: number): GrantRecord[] {
    if (!this.policy.activity || !ACTIVITY_DAILY_KINDS.has(activity.kind)) return [];
    const policy = this.policy.activity;
    return this.sql.transaction(() => {
      const r = markActiveDay(this.load(), policy, Math.min(activity.at, now));
      if (r.reason !== "ok") return [];
      const paid = this.pay(userId, r.grants, now);
      this.save(r.state, now);
      return paid;
    });
  }

  status(now: number, state?: RetentionState): RetentionStatus {
    const s = state ?? this.load();
    const day = economyDay(now);
    const week = economyWeek(now);
    const att = this.policy.attendance;
    const act = this.policy.activity;
    const ws = this.policy.weeklyStreak;
    // Would today's activity continue the streak? (a gap longer than the rest budget breaks it)
    const preview = act && s.act.lastDay !== day ? markActiveDay(s, act, now).state.act : s.act;
    const broken = !!act && s.act.current > 0 && s.act.lastDay !== day && preview.current === 1;
    const restUsed = s.act.restWeek === week ? s.act.rest : 0;
    const wsThisWeek = s.ws.week === week ? s.ws : { current: 0, best: 0, paidCoins: 0, paidTiers: [] as number[] };
    return {
      enabled: true,
      policy: this.policy.version,
      serverTime: now,
      day,
      week,
      attendance: { claimedToday: s.att.lastDay === day, claimed: s.att.claimed, cycle: s.att.cycle, total: s.att.total, rewards: att ? att.rewards.map((r) => ({ ...r })) : [], nextResetAt: nextDayStart(now) },
      activity: {
        current: broken ? 0 : s.act.current, best: s.act.best, activeToday: s.act.lastDay === day, broken,
        restPerWeek: act?.restDaysPerWeek ?? 0, restLeft: Math.max(0, (act?.restDaysPerWeek ?? 0) - restUsed),
        milestones: (act?.milestones ?? []).map((m) => ({ ...m, paid: s.act.paid.includes(m.days) })),
      },
      weeklyStreak: {
        current: wsThisWeek.current, best: wsThisWeek.best, paidCoins: wsThisWeek.paidCoins,
        tiers: (ws?.tiers ?? []).map((t) => ({ streak: t.streak, coins: t.coins, paid: wsThisWeek.paidTiers.includes(t.streak) })),
        nextResetAt: nextWeekStart(now),
      },
    };
  }
}

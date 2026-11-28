import { describe, expect, it } from "vitest";
import {
  ACTIVITY, ATTENDANCE, DAILY_PLAY, PACKAGES, RETENTION_ACTIVE, WEEKLY_STREAK, RETURN,
  applyDailyPlay, applyRetentionMatch, applyReturn, applyWeeklyStreak, claimAttendance, dailyPlayEligible, markActiveDay, newRetentionState,
} from "../src/economy/retention/policy";
import { applyMatch, newEconState, type RewardInput } from "../src/economy/live/rewards";
import { economyDay } from "../src/economy/live/config";
import { GRANT_LIMITS } from "../worker/src/grants";

/** C5 retention candidates (inactive). Times are KST: the economy day turns at 00:00 KST (15:00 UTC). */
const DAY = 86_400_000;
const kst = (iso: string) => Date.parse(iso + "+09:00");
const D1 = kst("2026-12-07T10:00:00"); // a Monday
const sum = (g: { coins: number }[]) => g.reduce((a, x) => a + x.coins, 0);

describe("C5 보상 후보는 비활성", () => {
  it("운영 플래그가 꺼져 있다", () => expect(RETENTION_ACTIVE).toBe(false));
  it("모든 후보 금액이 지급 엔진 출처별 한도 안이다", () => {
    for (const p of Object.values(ATTENDANCE)) for (const r of p.rewards) expect(r.coins <= GRANT_LIMITS.attendance.coins && r.gems <= GRANT_LIMITS.attendance.gems).toBe(true);
    for (const p of Object.values(DAILY_PLAY)) expect(Math.max(p.perMatch, p.completion.coins)).toBeLessThanOrEqual(GRANT_LIMITS["daily-play"].coins);
    for (const p of Object.values(ACTIVITY)) for (const m of p.milestones) expect(m.coins <= GRANT_LIMITS["activity-streak"].coins && m.gems <= GRANT_LIMITS["activity-streak"].gems).toBe(true);
    for (const p of Object.values(WEEKLY_STREAK)) for (const t of p.tiers) expect(t.coins).toBeLessThanOrEqual(GRANT_LIMITS["weekly-streak"].coins);
  });
});

describe("7일 누적 출석", () => {
  it("제안안은 7회에 200코인·3보석, 미접속해도 진행도가 유지되고, 7일차 뒤 새 주기", () => {
    const p = ATTENDANCE["ATT-200"];
    let s = newRetentionState();
    const got: number[] = [];
    let gems = 0;
    const ids: string[] = [];
    for (let i = 0; i < 9; i++) {
      // skip days on purpose: claim on every third day
      const r = claimAttendance(s, p, D1 + i * 3 * DAY);
      s = r.state;
      got.push(r.grants[0].coins);
      gems += r.grants[0].gems;
      ids.push(r.grants[0].txId);
    }
    expect(got).toEqual([10, 15, 20, 25, 30, 40, 60, 10, 15]);
    expect(sum(got.slice(0, 7).map((coins) => ({ coins })))).toBe(200);
    expect(gems).toBe(3);
    expect(ids.slice(6, 8)).toEqual(["att:0:7", "att:1:1"]);
  });
  it("한국 시간 하루 한 번: 같은 KST 날짜의 두 번째 수령은 없음, 자정이 지나면 가능", () => {
    const p = ATTENDANCE["ATT-150"];
    const late = kst("2026-12-07T23:59:00");
    const r1 = claimAttendance(newRetentionState(), p, late);
    expect(claimAttendance(r1.state, p, kst("2026-12-06T08:00:00")).reason).toBe("clock-behind");
    expect(claimAttendance(r1.state, p, late + 30_000).reason).toBe("already-claimed");
    const r2 = claimAttendance(r1.state, p, kst("2026-12-08T00:00:30"));
    expect(r2.grants).toHaveLength(1);
    // 00:00 KST = 15:00 UTC of the previous calendar day
    expect(economyDay(Date.parse("2026-12-07T15:00:00Z"))).toBe(economyDay(kst("2026-12-08T00:00:00")));
  });
});

const input = (over: Partial<RewardInput> = {}): RewardInput => ({
  matchId: "m1", kind: "random", outcome: "loss", endReason: "completed", score: 180, card: {}, endedAt: D1, opponentUserId: "u_x", ...over,
});

describe("일일 경기 보상", () => {
  it("3×5 + 완료 10 = 하루 25, 승패·무승부 동일, 4번째부터 없음, 다음 날 초기화", () => {
    const p = DAILY_PLAY["DP-3x5"];
    let s = newRetentionState();
    const coins: number[] = [];
    for (let k = 0; k < 4; k++) {
      const r = applyDailyPlay(s, p, true, D1 + k * 60_000);
      s = r.state;
      coins.push(sum(r.grants));
    }
    expect(coins).toEqual([5, 5, 15, 0]);
    expect(sum(applyDailyPlay(s, p, true, D1 + DAY).grants)).toBe(5);
  });
  it("정상 완료 경기만: 기권·상대 기권승·친구 상한·같은 상대 상한은 집계하지 않는다", () => {
    const ok = { countable: true, reason: "ok" };
    expect(dailyPlayEligible({ endReason: "completed" }, ok)).toBe(true);
    expect(dailyPlayEligible({ endReason: "completed" }, { countable: true, reason: "daily-cap" })).toBe(true);
    expect(dailyPlayEligible({ endReason: "resign" }, { countable: false, reason: "own-forfeit" })).toBe(false);
    expect(dailyPlayEligible({ endReason: "left" }, ok)).toBe(false); // opponent forfeit (countable for live coins)
    expect(dailyPlayEligible({ endReason: "completed" }, { countable: true, reason: "friend-cap" })).toBe(false);
    expect(dailyPlayEligible({ endReason: "completed" }, { countable: true, reason: "same-opponent-cap" })).toBe(false);
  });
  it("실제 경기 정산(applyMatch)의 같은 상대 상한과 맞물린다", () => {
    let econ = newEconState("u_me", D1);
    let s = newRetentionState();
    let paid = 0;
    for (let k = 0; k < 5; k++) {
      const inp = input({ matchId: `m${k}`, endedAt: D1 + k * 60_000, opponentUserId: "u_same" });
      const out = applyMatch(econ, inp, { userId: "u_me", createdAt: 0 });
      econ = out.state;
      const r = applyRetentionMatch(s, PACKAGES["C5-FULL"], inp, out);
      s = r.state;
      paid += sum(r.grants.filter((g) => g.source === "daily-play"));
    }
    // 3 rewarded vs the same opponent → the 3-match daily play completes once (15)
    expect(paid).toBe(15);
  });
});

describe("연속 활동", () => {
  it("이정표는 계정당 한 번, 주 1회 휴식일은 연속을 끊지 않는다", () => {
    const p = ACTIVITY["ACT-REST1"];
    let s = newRetentionState();
    const paid: string[] = [];
    // active every day except one day per week
    for (let d = 0; d < 40; d++) {
      if (d % 7 === 3) continue;
      const r = markActiveDay(s, p, D1 + d * DAY);
      s = r.state;
      paid.push(...r.grants.map((g) => g.txId));
    }
    expect(paid).toEqual(["act:m3", "act:m7", "act:m14", "act:m30"]);
    expect(s.act.current).toBe(40 - 6);
  });
  it("휴식일이 없으면 하루 결석으로 1부터 다시, 이미 받은 이정표는 다시 주지 않는다", () => {
    const p = ACTIVITY["ACT-STRICT"];
    let s = newRetentionState();
    let total = 0;
    for (let d = 0; d < 20; d++) {
      if (d === 5) continue;
      const r = markActiveDay(s, p, D1 + d * DAY);
      s = r.state;
      total += sum(r.grants);
    }
    expect(s.act.current).toBe(14);
    expect(total).toBe(30 + 60 + 100);
    expect(markActiveDay(s, p, D1 + 19 * DAY).reason).toBe("already-active");
  });
  it("한 주에 이틀 쉬면(휴식 1회) 끊긴다", () => {
    const p = ACTIVITY["ACT-REST1"];
    let s = markActiveDay(newRetentionState(), p, D1).state; // Monday
    s = markActiveDay(s, p, D1 + 3 * DAY).state; // Thu: two missed days in one week
    expect(s.act.current).toBe(1);
  });
});

describe("주간 최고 연승", () => {
  const P = WEEKLY_STREAK["WS-15-30-50"];
  const run = (seq: Partial<RewardInput>[]) => {
    let s = newRetentionState();
    let coins = 0;
    seq.forEach((m, i) => {
      const r = applyWeeklyStreak(s, P, input({ endedAt: D1 + i * 60_000, ...m }));
      s = r.state;
      coins += sum(r.grants);
    });
    return { s, coins };
  };
  const win = (opp: string): Partial<RewardInput> => ({ outcome: "win", opponentUserId: opp });
  it("3·5·8연승에 한 주 최대 50코인, 끊겨도 받은 단계는 유지", () => {
    const eight = Array.from({ length: 8 }, (_, i) => win("u_" + i));
    expect(run(eight.slice(0, 3)).coins).toBe(15);
    expect(run(eight.slice(0, 5)).coins).toBe(30);
    expect(run([...eight, { outcome: "loss" }, ...eight.map((m, i) => ({ ...m, opponentUserId: "u_b" + i }))]).coins).toBe(50);
  });
  it("같은 상대 반복 승리·상대 기권승·무승부는 늘지 않고, 친구·AI 경기는 무시", () => {
    const r = run([win("u_a"), win("u_a"), { outcome: "win", endReason: "left", opponentUserId: "u_b" }, { outcome: "draw" }, { ...win("u_c"), kind: "friend" }, { ...win("u_d"), kind: "ai" }]);
    expect(r.s.ws.current).toBe(1);
    expect(r.coins).toBe(0);
  });
  it("주가 바뀌면 0부터", () => {
    let s = newRetentionState();
    for (let i = 0; i < 3; i++) s = applyWeeklyStreak(s, P, input({ ...win("u_" + i), endedAt: D1 + i })).state;
    const next = applyWeeklyStreak(s, P, input({ ...win("u_9"), endedAt: D1 + 7 * DAY }));
    expect(next.state.ws.best).toBe(1);
    expect(next.grants).toEqual([]);
  });
});

describe("복귀 보상(향후 후보)", () => {
  it("14일 넘게 쉬다 돌아오면 한 번, 60일 안에는 다시 없음", () => {
    const p = RETURN["RET-14"];
    const day0 = economyDay(D1);
    const r = applyReturn(newRetentionState(), p, day0 - 20, D1);
    expect(sum(r.grants)).toBe(150);
    expect(applyReturn(r.state, p, day0 - 20, D1 + 30 * DAY).reason).toBe("cooldown");
    expect(applyReturn(newRetentionState(), p, day0 - 5, D1).reason).toBe("not-returning");
  });
});

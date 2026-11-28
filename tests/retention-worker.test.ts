import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { EconomyStore, type EconSql } from "../worker/src/economy";
import { AccountStore } from "../worker/src/account";
import { RewardGrants } from "../worker/src/grants";
import { RetentionStore } from "../worker/src/retention";
import { authConfig, handleAccountRoute, missingQuote, type AccountBackends, type UserApi } from "../worker/src/accounts-api";
import { RULES_ID, type MatchRecord } from "../src/identity/records";
import { APPROVED_POLICY, ATTENDANCE } from "../src/economy/retention/policy";
import type { RewardInput } from "../src/economy/live/rewards";
import { DRAW_TIERS, drawItems } from "../src/economy/live/draw";
import { itemById } from "../src/economy/live/catalog";

/**
 * C5-CORE in the account object (approved 2026-11-28): attendance ATT-150, activity streak ACT-REST1,
 * weekly best streak WS-15-30-50 — over real SQLite, with the same order as UserStore.recordMatch
 * (record + live settlement + retention in ONE transaction).
 */
function sql(): EconSql {
  const db = new DatabaseSync(":memory:");
  let depth = 0;
  return {
    exec<T>(query: string, ...params: unknown[]) {
      const stmt = db.prepare(query);
      const rows = /^\s*(select|pragma)/i.test(query) ? (stmt.all(...(params as never[])) as T[]) : (stmt.run(...(params as never[])), [] as T[]);
      return { toArray: () => rows };
    },
    transaction<T>(fn: () => T): T {
      // joins an outer transaction like the Worker's econSql (no savepoints there either)
      if (depth > 0) return fn();
      depth++;
      db.exec("BEGIN");
      try {
        const r = fn();
        db.exec("COMMIT");
        return r;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      } finally {
        depth--;
      }
    },
  };
}
const U = "u_" + "r".repeat(22);
const DAY = 86_400_000;
const kst = (iso: string) => Date.parse(iso + "+09:00");
const MON = kst("2026-12-07T10:00:00"); // a Monday

function setup() {
  const db = sql();
  const account = new AccountStore(db);
  account.init();
  account.ensureUser(U, "google", MON - 90 * DAY);
  const econ = new EconomyStore(db);
  econ.init();
  econ.welcome(U, MON - 90 * DAY, null);
  const grants = new RewardGrants(db, econ);
  grants.init();
  const retention = new RetentionStore(db, grants);
  retention.init();
  let n = 0;
  const record = (over: Partial<MatchRecord> = {}): MatchRecord => ({
    recordId: `m_${n++}`, mode: "online", rules: RULES_ID, source: "server", verification: "server-verified", kind: "random",
    startedAt: MON - 600_000, endedAt: MON, name: "나", score: 190, card: { yacht: 50 }, outcome: "loss", endReason: "completed",
    opponent: { name: "상대", kind: "member", score: 200, userId: "u_" + "o".repeat(22) }, ...over,
  } as MatchRecord);
  /** UserStore.recordMatch with RETENTION="on". */
  const deliver = (r: MatchRecord, now = r.endedAt) => db.transaction(() => account.recordMatch(r, () => {
    const input: RewardInput = { matchId: r.recordId, kind: r.kind ?? "friend", outcome: r.outcome, endReason: r.endReason, score: r.score, card: r.card, opponentUserId: r.opponent.userId, endedAt: r.endedAt };
    const settled = econ.applyMatch(U, MON - 90 * DAY, input, now);
    const countable = settled.reason !== "own-forfeit" && settled.reason !== "too-short";
    retention.onMatch(U, r, input, { countable, reason: settled.reason }, now);
    return settled.receipt;
  }));
  const ledger = (prefix: string) => econ.snapshot(U, MON, 200).ledger.filter((l) => l.id.startsWith(prefix));
  return { db, account, econ, grants, retention, record, deliver, ledger };
}
const opp = (i: number) => "u_" + String(i).padStart(22, "x");

describe("출석 ATT-150 (계정 객체)", () => {
  it("결석해도 진행도 유지, 7회에 150코인·3보석, 8번째는 새 주기 1일차", () => {
    const { retention, econ, grants, ledger } = setup();
    const before = econ.balance();
    for (let i = 0; i < 8; i++) expect(retention.claimAttendance(U, MON + i * 2 * DAY).ok).toBe(true);
    const att = ledger("g:att:");
    expect(att.slice().reverse().map((l) => l.coins)).toEqual([10, 10, 15, 15, 20, 20, 60, 10]);
    expect(econ.balance()).toEqual({ coins: before.coins + 160, gems: before.gems + 3 });
    expect(att.map((l) => l.id)).toContain("g:att:1:1");
    expect(econ.verify().ok && grants.verify().ok).toBe(true);
  });
  it("KST 하루 한 번: 같은 날 두 번째(두 기기 동시 포함)는 ALREADY_CLAIMED, 자정 직후는 새 날", () => {
    const { retention, ledger } = setup();
    expect(retention.claimAttendance(U, kst("2026-12-07T23:59:59")).ok).toBe(true);
    expect(retention.claimAttendance(U, kst("2026-12-07T23:59:59") + 500)).toMatchObject({ ok: false, code: "ALREADY_CLAIMED" });
    expect(retention.claimAttendance(U, kst("2026-12-08T00:00:00")).ok).toBe(true);
    // 00:00 KST is 15:00 UTC of the previous calendar day
    expect(retention.claimAttendance(U, Date.parse("2026-12-08T15:00:00Z")).ok).toBe(true);
    expect(ledger("g:att:")).toHaveLength(3);
  });
  it("출석 수령만으로는 연속 활동이 되지 않는다", () => {
    const { retention } = setup();
    for (let i = 0; i < 5; i++) retention.claimAttendance(U, MON + i * DAY);
    expect(retention.status(MON + 4 * DAY).activity).toMatchObject({ current: 0, best: 0 });
  });
});

describe("연속 활동 ACT-REST1 (서버 검증 경기)", () => {
  it("주 1회 휴식으로 30일 이정표까지: 30·60·100·200코인, 보석 0·2·3·5, 30일 칭호(비매품) 지급", () => {
    const { deliver, record, econ, ledger, retention } = setup();
    const start = econ.balance();
    let d = 0;
    let active = 0;
    while (active < 30) {
      if (d % 7 !== 3) {
        deliver(record({ endedAt: MON + d * DAY }));
        active++;
      }
      d++;
    }
    expect(ledger("g:act:").map((l) => l.id).sort()).toEqual(["g:act:m14", "g:act:m3", "g:act:m30", "g:act:m7"]);
    const actCoins = ledger("g:act:").reduce((a, l) => a + l.coins, 0);
    expect(actCoins).toBe(390);
    expect(ledger("g:act:").reduce((a, l) => a + l.gems, 0)).toBe(10);
    const title = econ.snapshot(U, MON).inventory.find((i) => i.id === "title.streak30");
    expect(title).toMatchObject({ via: "achievement" });
    // the title does not count toward the "아이템 3·10개 보유" achievements (achievement-only, like other titles)
    expect(econ.snapshot(U, MON).state.counters.items ?? 0).toBe(0);
    expect(retention.status(MON + (d - 1) * DAY).activity).toMatchObject({ current: 30, activeToday: true });
    expect(econ.balance().coins).toBeGreaterThan(start.coins + 390);
  });
  it("한 주에 이틀 쉬면 끊기고, 다시 3일을 채워도 이정표는 평생 한 번", () => {
    const { deliver, record, ledger, retention } = setup();
    for (const d of [0, 1, 2]) deliver(record({ endedAt: MON + d * DAY }));
    expect(ledger("g:act:")).toHaveLength(1);
    expect(retention.status(MON + 5 * DAY).activity).toMatchObject({ broken: true, current: 0 });
    for (const d of [5, 6, 7]) deliver(record({ endedAt: MON + d * DAY }));
    expect(ledger("g:act:")).toHaveLength(1);
  });
  it("휴식 예산은 월요일 KST 00:00에 새로 생긴다(일요일 결석 + 다음 주 월요일 결석도 이어짐)", () => {
    const { deliver, record, retention } = setup();
    const sat = kst("2026-12-12T20:00:00");
    deliver(record({ endedAt: sat }));
    // Sunday 12-13 missed (week 1 rest), Monday 12-14 missed (week 2 rest), Tuesday active → still a streak
    deliver(record({ endedAt: kst("2026-12-15T09:00:00") }));
    expect(retention.status(kst("2026-12-15T09:00:00")).activity.current).toBe(2);
    expect(retention.status(kst("2026-12-15T09:00:00")).activity.restLeft).toBe(0);
    expect(retention.status(kst("2026-12-21T00:00:01")).activity.restLeft).toBe(1);
  });
  it("본인 기권·상대 기권승·친구 상한 초과·클라이언트 기록은 활동이 아니다", () => {
    const { deliver, record, retention, account } = setup();
    deliver(record({ endedAt: MON, outcome: "loss", endReason: "resign" }));
    deliver(record({ endedAt: MON + DAY, outcome: "win", endReason: "left" }));
    for (let i = 0; i < 11; i++) deliver(record({ endedAt: MON + 2 * DAY + i * 60_000, kind: "friend", opponent: { name: "친구", kind: "member", score: 1, userId: opp(1) } }));
    account.importRecords([record({ endedAt: MON + 3 * DAY })], "device", MON + 3 * DAY);
    deliver(record({ endedAt: MON + 4 * DAY, source: "device", verification: "client-reported" }));
    // only the 10 friend matches inside the cap on day 2 count — one active day
    expect(retention.status(MON + 2 * DAY).activity).toMatchObject({ current: 1, best: 1 });
    expect(retention.status(MON + 4 * DAY).activity.best).toBe(1);
  });
  it("같은 경기의 재배달·SEC-1-01 대체(기기 기록 선점 → 서버 결과)도 한 번만 집계", () => {
    const { deliver, record, account, ledger } = setup();
    for (const d of [0, 1]) deliver(record({ endedAt: MON + d * DAY }));
    const third = record({ endedAt: MON + 2 * DAY });
    account.importRecords([{ ...third, outcome: "win" }], "device", MON + 2 * DAY);
    expect(deliver(third)).toBe(true);
    expect(deliver(third)).toBe(false);
    expect(ledger("g:act:m3")).toHaveLength(1);
  });
  it("승인된 일일 콘텐츠(공식 오늘의 요트 완료)만 활동으로 인정, 퍼즐·시작은 아님", () => {
    const { retention } = setup();
    expect(retention.onDailyContent(U, { kind: "daily.puzzle.answered", at: MON }, MON)).toEqual([]);
    expect(retention.onDailyContent(U, { kind: "daily.official.started", at: MON }, MON)).toEqual([]);
    expect(retention.status(MON).activity.current).toBe(0);
    retention.onDailyContent(U, { kind: "daily.official.completed", at: MON }, MON);
    retention.onDailyContent(U, { kind: "daily.official.completed", at: MON + DAY }, MON + DAY);
    retention.onDailyContent(U, { kind: "daily.official.completed", at: MON + 2 * DAY }, MON + 2 * DAY);
    expect(retention.status(MON + 2 * DAY).activity.current).toBe(3);
  });
});

describe("주간 최고 연승 WS-15-30-50 (빠른 1:1 대전)", () => {
  it("서로 다른 상대 8연승 = 15 + 15 + 20 (주 최대 50), 끊겨도 받은 단계 유지", () => {
    const { deliver, record, ledger } = setup();
    for (let i = 0; i < 8; i++) deliver(record({ endedAt: MON + i * 60_000, outcome: "win", opponent: { name: "o", kind: "member", score: 1, userId: opp(i) } }));
    deliver(record({ endedAt: MON + 9 * 60_000, outcome: "loss" }));
    for (let i = 0; i < 8; i++) deliver(record({ endedAt: MON + (10 + i) * 60_000, outcome: "win", opponent: { name: "o", kind: "member", score: 1, userId: opp(20 + i) } }));
    expect(ledger("g:ws:").map((l) => l.coins).sort((a, b) => a - b)).toEqual([15, 15, 20]);
  });
  it("같은 상대 반복 승리·게스트 상대 승리·무승부·상대 기권승은 증가 없음, 친구·AI 경기 무시", () => {
    const { deliver, record, retention } = setup();
    const t = (i: number) => MON + i * 60_000;
    deliver(record({ endedAt: t(0), outcome: "win", opponent: { name: "o", kind: "member", score: 1, userId: opp(1) } }));
    deliver(record({ endedAt: t(1), outcome: "win", opponent: { name: "o", kind: "member", score: 1, userId: opp(1) } }));
    deliver(record({ endedAt: t(2), outcome: "win", opponent: { name: "g", kind: "guest", score: 1 } }));
    deliver(record({ endedAt: t(3), outcome: "draw", opponent: { name: "o", kind: "member", score: 1, userId: opp(2) } }));
    deliver(record({ endedAt: t(4), outcome: "win", endReason: "left", opponent: { name: "o", kind: "member", score: 1, userId: opp(3) } }));
    deliver(record({ endedAt: t(5), outcome: "win", kind: "friend", opponent: { name: "o", kind: "member", score: 1, userId: opp(4) } }));
    deliver(record({ endedAt: t(6), outcome: "win", kind: "ai", opponent: { name: "AI", kind: "ai", score: 1 } }));
    expect(retention.status(t(6)).weeklyStreak).toMatchObject({ current: 1, best: 1 });
  });
  it("월요일 KST 00:00에 0부터 다시 (일요일 23:59 vs 월요일 00:00)", () => {
    const { deliver, record, retention } = setup();
    const sun = kst("2026-12-13T23:59:00");
    for (let i = 0; i < 3; i++) deliver(record({ endedAt: sun + i * 10_000, outcome: "win", opponent: { name: "o", kind: "member", score: 1, userId: opp(i) } }));
    expect(retention.status(sun + 40_000).weeklyStreak.best).toBe(3);
    const mon = kst("2026-12-14T00:00:00");
    expect(retention.status(mon).weeklyStreak).toMatchObject({ current: 0, best: 0, paidCoins: 0 });
    deliver(record({ endedAt: mon, outcome: "win", opponent: { name: "o", kind: "member", score: 1, userId: opp(9) } }));
    expect(retention.status(mon).weeklyStreak.best).toBe(1);
  });
  it("기존 연승 업적 카운터 규칙은 그대로다(무승부에도 0, 같은 상대도 +1)", () => {
    const { deliver, record, econ } = setup();
    for (let i = 0; i < 3; i++) deliver(record({ endedAt: MON + i * 60_000, outcome: "win" }));
    expect(econ.snapshot(U, MON).state.streak).toBe(3);
    deliver(record({ endedAt: MON + 5 * 60_000, outcome: "draw" }));
    expect(econ.snapshot(U, MON).state.streak).toBe(0);
  });
});

describe("장기 활동 칭호 (비매품)", () => {
  it("구매·뽑기로 얻을 수 없고, 연속 활동 이정표에만 들어 있다", () => {
    const { econ } = setup();
    for (const id of ["title.streak30", "title.streak100", "title.streak365"]) {
      expect(itemById(id)).toMatchObject({ category: "title", tier: "special", acquisition: "achievement", drawExcluded: true });
      expect(econ.buy(U, id, "coins", "req-" + id.replace(/\W/g, "") + "-1", MON)).toMatchObject({ ok: false, code: "NOT_FOR_SALE" });
      expect(econ.buy(U, id, "gems", "req-" + id.replace(/\W/g, "") + "-2", MON)).toMatchObject({ ok: false, code: "NOT_FOR_SALE" });
      for (const tier of DRAW_TIERS) expect(drawItems("standard", tier).some((i) => i.id === id)).toBe(false);
    }
    expect(APPROVED_POLICY.activity!.milestones.filter((m) => m.title).map((m) => [m.days, m.title])).toEqual([[30, "title.streak30"], [100, "title.streak100"], [365, "title.streak365"]]);
  });
});

describe("상태·정책 버전", () => {
  it("상태는 승인 정책 버전과 금액을 그대로 보여 준다", () => {
    const { retention } = setup();
    const s = retention.status(MON);
    expect(s.policy).toBe(APPROVED_POLICY.version);
    expect(s.attendance.rewards).toEqual(ATTENDANCE["ATT-150"].rewards);
    expect(s.activity.milestones.map((m) => [m.days, m.coins, m.gems])).toEqual([[3, 30, 0], [7, 60, 2], [14, 100, 3], [30, 200, 5], [100, 400, 10], [180, 500, 15], [365, 1000, 30]]);
    expect(s.weeklyStreak.tiers.map((t) => [t.streak, t.coins])).toEqual([[3, 15], [5, 30], [8, 50]]);
    expect(s.attendance.nextResetAt).toBe(kst("2026-12-08T00:00:00"));
    expect(s.weeklyStreak.nextResetAt).toBe(kst("2026-12-14T00:00:00"));
  });
});

describe("계정 API (C5 보상 경로)", () => {
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
  const api = (user: Partial<UserApi>, opts: Partial<AccountBackends> = {}) => {
    const b = {
      user: () => ({ authenticate: async () => true, ...user }) as unknown as UserApi,
      guest: () => { throw Error("no guest"); },
      limited: async () => false,
      fetcher: fetch,
      now: () => MON,
      ...opts,
    } as AccountBackends;
    return async (path: string, body?: unknown) => {
      const req = new Request("https://w.example" + path, { method: body === undefined ? "GET" : "POST", headers: { authorization: `Bearer s1.${U}.${"a".repeat(43)}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
      const cfg = authConfig({ GOOGLE_CLIENT_ID: "c.apps.googleusercontent.com", GOOGLE_CLIENT_SECRET: "s", AUTH_SECRET: "k".repeat(40), APP_URL: "https://app.example/YachtLab/" });
      const res = (await handleAccountRoute(req, new URL(req.url), cfg, b, "c", reply))!;
      return { status: res.status, body: await res.json() as Record<string, unknown> };
    };
  };
  it("보상 기능이 없는(구) 계정 객체·꺼진 Worker는 404 RETENTION_OFF", async () => {
    const call = api({});
    expect(await call("/api/me/rewards")).toMatchObject({ status: 404 });
    expect((await call("/api/me/rewards/attendance", {})).body).toMatchObject({ error: { code: "RETENTION_OFF" } });
    const off = api({ rewards: async () => ({ ok: false, code: "RETENTION_OFF", message: "x" }) });
    expect(await off("/api/me/rewards")).toMatchObject({ status: 404 });
  });
  it("수령 상태 코드: 이미 받음 409, 만료 410, 잘못된 txId 400, 교환 코드 꺼짐 404", async () => {
    const call = api({
      rewards: async () => ({ ok: true, status: {} }),
      claimAttendance: async () => ({ ok: false, code: "ALREADY_CLAIMED", message: "x" }),
      claimReward: async () => ({ ok: false, code: "EXPIRED", message: "x" }),
      redeemCode: async () => ({ ok: false, code: "REDEEM_OFF", message: "x" }),
    });
    expect((await call("/api/me/rewards")).status).toBe(200);
    expect((await call("/api/me/rewards/attendance", {})).status).toBe(409);
    expect((await call("/api/me/rewards/claim", { txId: "op:camp-1" })).status).toBe(410);
    expect((await call("/api/me/rewards/claim", { txId: "bad id" })).status).toBe(400);
    expect((await call("/api/me/rewards/redeem", { code: "ABCD-1234" })).status).toBe(404);
  });
  it("견적 필수 단계(ECONOMY_QUOTE=required): 필드가 빠진 구형 요청은 409 CLIENT_UPDATE_REQUIRED, 차감 경로에 닿지 않는다", async () => {
    let calls = 0;
    const user = { buy: async () => (calls++, { ok: true as const, snapshot: {} }), upgrade: async () => (calls++, { ok: true as const, snapshot: {} }) };
    const strict = api(user, { quoteRequired: true });
    expect((await strict("/api/me/shop/buy", { itemId: "dice.mint", currency: "coins", requestId: "req-aaaaaaaa" })).body).toMatchObject({ error: { code: "CLIENT_UPDATE_REQUIRED" } });
    expect((await strict("/api/me/shop/upgrade", { itemId: "dice.mint", requestId: "req-bbbbbbbb", expectedPrice: 150, configVersion: "M3i-W30@2" })).status).toBe(409);
    expect(calls).toBe(0);
    expect((await strict("/api/me/shop/buy", { itemId: "dice.mint", currency: "coins", requestId: "req-cccccccc", expectedPrice: 300, configVersion: "M3i-W30@2" })).status).toBe(200);
    expect((await api(user)("/api/me/shop/buy", { itemId: "dice.mint", currency: "coins", requestId: "req-dddddddd" })).status).toBe(200);
    expect(missingQuote("/api/me/shop/draw", { expectedPrice: 250, configVersion: "x" })).toBe(true);
    expect(missingQuote("/api/me/shop/draw", { expectedPrice: 250, configVersion: "x", oddsVersion: "odds1-x" })).toBe(false);
  });
});

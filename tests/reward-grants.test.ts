import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { EconomyStore, type EconSql } from "../worker/src/economy";
import { APPROVED_SOURCES, GRANT_SOURCES, RewardGrants, validateGrant, type GrantRequest } from "../worker/src/grants";
import { checkCode, hashCode, normalizeCode, type CodeDef } from "../src/economy/retention/codes";

/**
 * C5 reward grant engine over real SQLite (node:sqlite, the same SQL as the account Durable Object).
 * Inactive prototype: these tests pin the contract that 05/06 build on before anything is wired in.
 */
function sql(): EconSql & { db: DatabaseSync } {
  const db = new DatabaseSync(":memory:");
  let depth = 0;
  return {
    db,
    exec<T>(query: string, ...params: unknown[]) {
      const stmt = db.prepare(query);
      const rows = /^\s*select/i.test(query) ? (stmt.all(...(params as never[])) as T[]) : (stmt.run(...(params as never[])), [] as T[]);
      return { toArray: () => rows };
    },
    // Re-entrant like the Worker's econSql (savepoints), so a grant can join the match transaction.
    transaction<T>(fn: () => T): T {
      const name = `sp${depth++}`;
      db.exec(`SAVEPOINT ${name}`);
      try {
        const r = fn();
        db.exec(`RELEASE ${name}`);
        return r;
      } catch (e) {
        db.exec(`ROLLBACK TO ${name}`);
        db.exec(`RELEASE ${name}`);
        throw e;
      } finally {
        depth--;
      }
    },
  };
}
const U = "u_" + "a".repeat(22);
const T0 = Date.parse("2026-12-01T12:00:00+09:00");
const setup = () => {
  const db = sql();
  const econ = new EconomyStore(db);
  econ.init();
  econ.welcome(U, T0, null);
  // contract tests exercise every source; a Worker enables only approved ones (see "출처 승인")
  const grants = new RewardGrants(db, econ, { enabled: new Set(GRANT_SOURCES) });
  grants.init();
  return { db, econ, grants };
};
const req = (over: Partial<GrantRequest> = {}): GrantRequest => ({
  txId: "att:0:1", source: "attendance", coins: 10, gems: 0, policyVersion: "R-C5@0", label: "출석 1일차", actor: "system", delivery: "direct", ...over,
});

describe("보상 지급 엔진 (원장 재사용)", () => {
  it("즉시 지급은 원장 한 행·잔액·지급 기록을 함께 남기고, 기존 원장 검사와 맞는다", () => {
    const { econ, grants } = setup();
    const r = grants.issue(U, req(), T0);
    expect(r.ok && !r.duplicate && r.record.status).toBe("granted");
    expect(econ.snapshot(U, T0).wallet).toEqual({ coins: 210, gems: 20 });
    const row = econ.snapshot(U, T0).ledger.find((l) => l.id === "g:att:0:1")!;
    expect(row).toMatchObject({ kind: "attendance", coins: 10, coinsAfter: 210 });
    expect(econ.verify().ok).toBe(true);
    expect(grants.verify()).toMatchObject({ ok: true, grants: 1 });
  });

  it("같은 거래 ID의 재시도는 한 번만 지급하고, 다른 내용이면 충돌로 거부한다", () => {
    const { econ, grants } = setup();
    grants.issue(U, req(), T0);
    const again = grants.issue(U, req(), T0 + 5);
    expect(again.ok && again.duplicate).toBe(true);
    const conflict = grants.issue(U, req({ coins: 20 }), T0 + 6);
    expect(conflict).toMatchObject({ ok: false, code: "TX_CONFLICT" });
    expect(econ.snapshot(U, T0).wallet.coins).toBe(210);
    expect(econ.snapshot(U, T0).ledger.filter((l) => l.id.startsWith("g:"))).toHaveLength(1);
  });

  it("실패한 지급은 아무것도 남기지 않고(원자성), 같은 ID로 다시 시도할 수 있다", () => {
    const { db, econ, grants } = setup();
    // An existing ledger row with the grant's id (a corrupt/foreign write) makes credit() throw.
    db.exec("INSERT INTO ledger (event_id, at, kind, coins, gems, coins_after, gems_after, funding, label, config) VALUES ('g:dp:1:done', 0, 'x', 0, 0, 200, 20, 'play', 'x', 'x')");
    expect(() => grants.issue(U, req({ txId: "dp:1:done", source: "daily-play", coins: 15 }), T0)).toThrow();
    expect(grants.has("dp:1:done")).toBe(false);
    expect(econ.snapshot(U, T0).wallet.coins).toBe(200);
    db.exec("DELETE FROM ledger WHERE event_id = 'g:dp:1:done'");
    expect(grants.issue(U, req({ txId: "dp:1:done", source: "daily-play", coins: 15 }), T0).ok).toBe(true);
    expect(econ.snapshot(U, T0).wallet.coins).toBe(215);
    expect(econ.verify().ok && grants.verify().ok).toBe(true);
  });

  it("보상함: 받기 전에는 잔액이 그대로, 받기는 한 번만, 만료·취소된 보상은 지급하지 않는다", () => {
    const { econ, grants } = setup();
    const op = { actor: "admin:ops1", delivery: "inbox" as const };
    expect(grants.issue(U, req({ txId: "sug:s-1001", source: "suggestion", coins: 300, gems: 10, ...op }), T0, { operator: true }).ok).toBe(true);
    expect(grants.issue(U, req({ txId: "op:launch-gift", source: "operator", coins: 100, ...op, expiresAt: T0 + 1000 }), T0, { operator: true }).ok).toBe(true);
    expect(grants.issue(U, req({ txId: "op:typo-gift", source: "operator", coins: 50, ...op }), T0, { operator: true }).ok).toBe(true);
    expect(econ.snapshot(U, T0).wallet.coins).toBe(200);
    expect(grants.inbox(T0).map((g) => g.txId)).toEqual(["op:launch-gift", "op:typo-gift", "sug:s-1001"]);
    expect(grants.revoke("op:typo-gift", "admin:ops1", T0).ok).toBe(true);
    expect(grants.claim("op:launch-gift", T0 + 2000)).toMatchObject({ ok: false, code: "EXPIRED" });
    const c = grants.claim("sug:s-1001", T0 + 3000);
    expect(c.ok && c.record.status).toBe("claimed");
    expect(grants.claim("sug:s-1001", T0 + 4000)).toMatchObject({ ok: true, duplicate: true });
    expect(grants.claim("op:typo-gift", T0 + 4000)).toMatchObject({ ok: false, code: "REVOKED" });
    expect(econ.snapshot(U, T0).wallet).toEqual({ coins: 500, gems: 30 });
    expect(grants.revoke("sug:s-1001", "admin:ops1", T0)).toMatchObject({ ok: false, code: "NOT_REVOCABLE" });
    expect(econ.verify().ok && grants.verify().ok).toBe(true);
  });

  it("모두 받기는 받을 수 있는 보상만 한 트랜잭션에서 지급한다", () => {
    const { econ, grants } = setup();
    for (const [i, exp] of [[1, null], [2, T0 + 10], [3, null]] as const)
      grants.issue(U, req({ txId: `op:camp-${i}`, source: "operator", coins: 10 * i, actor: "admin:ops1", delivery: "inbox", expiresAt: exp }), T0, { operator: true });
    const all = grants.claimAll(T0 + 100);
    expect(all.claimed.map((g) => g.txId)).toEqual(["op:camp-1", "op:camp-3"]);
    expect(econ.snapshot(U, T0).wallet.coins).toBe(240);
    expect(grants.expire(T0 + 100)).toBe(1);
    expect(grants.claimAll(T0 + 200).claimed).toEqual([]);
  });

  it("클라이언트·시스템 경로는 운영자 출처를 쓸 수 없고, 한도·음수·소수·업적 전용 아이템을 거부한다", () => {
    const { grants } = setup();
    expect(grants.issue(U, req({ txId: "op:x-000001", source: "operator", actor: "system" }), T0)).toMatchObject({ code: "FORBIDDEN" });
    expect(grants.issue(U, req({ actor: "admin:ops1" }), T0)).toMatchObject({ code: "ACTOR" });
    expect(grants.issue(U, req({ coins: -5 }), T0)).toMatchObject({ code: "AMOUNT" });
    expect(grants.issue(U, req({ coins: 1.5 }), T0)).toMatchObject({ code: "AMOUNT" });
    expect(grants.issue(U, req({ coins: 201 }), T0)).toMatchObject({ code: "LIMIT" });
    expect(grants.issue(U, req({ txId: "op:big-0001", source: "operator", coins: 5001, actor: "admin:ops1" }), T0, { operator: true })).toMatchObject({ code: "LIMIT" });
    expect(grants.issue(U, req({ txId: "sug:item-01", source: "suggestion", coins: 0, items: ["title.300"], actor: "admin:ops1" }), T0, { operator: true })).toMatchObject({ code: "ITEM" });
    expect(grants.issue(U, req({ txId: "bad id!" }), T0)).toMatchObject({ code: "TX_ID" });
    expect(validateGrant(req({ coins: 0, gems: 0 }), { operator: false })).toMatchObject({ code: "EMPTY" });
  });

  it("아이템 지급은 인벤토리에 넣고, 이미 가진 아이템은 건너뛰어 기록한다", () => {
    const { econ, grants } = setup();
    expect(econ.buy(U, "title.rookie", "coins", "req-rook-0001", T0).ok).toBe(true);
    const r = grants.issue(U, req({ txId: "sug:s-2002", source: "suggestion", coins: 100, items: ["title.rookie"], actor: "admin:ops1" }), T0, { operator: true });
    expect(r.ok && r.record.skippedItems).toEqual(["title.rookie"]);
    expect(grants.issue(U, req({ txId: "op:felt-gift", source: "operator", coins: 0, items: ["board.felt", "bubble.mint"], actor: "admin:ops1" }), T0, { operator: true }).ok).toBe(true);
    expect(econ.snapshot(U, T0).inventory.map((i) => [i.id, i.via])).toContainEqual(["board.felt", "grant:operator"]);
    expect(econ.verify().ok && grants.verify().ok).toBe(true);
  });

  it("경제를 쓴 적 없는 계정에는 지급하지 않는다(가입 보상 경로가 먼저)", () => {
    const db = sql();
    const e = new EconomyStore(db);
    e.init();
    const g = new RewardGrants(db, e, { enabled: new Set(GRANT_SOURCES) });
    g.init();
    expect(g.issue(U, req(), T0)).toMatchObject({ ok: false, code: "NO_ECONOMY" });
  });

  it("검증은 지급 기록 없는 g: 원장 행과 금액 불일치를 찾아낸다", () => {
    const { db, grants } = setup();
    grants.issue(U, req(), T0);
    db.exec("UPDATE grant_tx SET coins = 11 WHERE tx_id = 'att:0:1'");
    db.exec("INSERT INTO ledger (event_id, at, kind, coins, gems, coins_after, gems_after, funding, label, config) VALUES ('g:ghost-0001', 0, 'operator', 0, 0, 210, 20, 'play', 'x', 'x')");
    const v = grants.verify();
    expect(v.ok).toBe(false);
    expect(v.problems).toEqual(expect.arrayContaining(["ledger row differs for att:0:1", "ledger row g:ghost-0001 has no grant"]));
  });

  it("지급 후에도 기존 구매·강화가 그대로 동작한다(같은 원장)", () => {
    const { econ, grants } = setup();
    grants.issue(U, req({ txId: "act:m30", source: "activity-streak", coins: 200, gems: 5 }), T0);
    expect(econ.buy(U, "dice.mint", "coins", "req-buy-00001", T0).ok).toBe(true);
    expect(econ.snapshot(U, T0).wallet).toEqual({ coins: 100, gems: 25 });
    expect(econ.verify().ok && grants.verify().ok).toBe(true);
  });
});

describe("출처 승인 (C5-CORE만 기본 활성)", () => {
  it("기본 설정은 출석·연속 활동·주간 연승만 지급하고, 운영자·제안·일일 콘텐츠·교환 코드·일일 경기는 SOURCE_DISABLED", () => {
    const db = sql();
    const econ = new EconomyStore(db);
    econ.init();
    econ.welcome(U, T0, null);
    const g = new RewardGrants(db, econ);
    g.init();
    expect([...APPROVED_SOURCES].sort()).toEqual(["activity-streak", "attendance", "weekly-streak"]);
    expect(g.issue(U, req(), T0).ok).toBe(true);
    for (const source of ["daily-content", "daily-play", "redeem-code", "event", "return"] as const)
      expect(g.issue(U, req({ txId: `x:${source}`, source, coins: 10 }), T0)).toMatchObject({ code: "SOURCE_DISABLED" });
    for (const source of ["operator", "suggestion", "compensation"] as const)
      expect(g.issue(U, req({ txId: `x:${source}`, source, coins: 10, actor: "admin:ops1" }), T0, { operator: true })).toMatchObject({ code: "SOURCE_DISABLED" });
    expect(econ.snapshot(U, T0).wallet.coins).toBe(210);
    expect(g.history().map((r) => r.txId)).toEqual(["att:0:1"]);
  });
  it("보상함에 남은 항목은 출처가 꺼지면 수령되지 않는다(켜지면 다시 가능)", () => {
    const db = sql();
    const econ = new EconomyStore(db);
    econ.init();
    econ.welcome(U, T0, null);
    const on = new RewardGrants(db, econ, { enabled: new Set(GRANT_SOURCES) });
    on.init();
    on.issue(U, req({ txId: "sug:s-9", source: "suggestion", coins: 100, actor: "admin:ops1", delivery: "inbox" }), T0, { operator: true });
    expect(new RewardGrants(db, econ).claim("sug:s-9", T0)).toMatchObject({ code: "SOURCE_DISABLED" });
    expect(on.claim("sug:s-9", T0).ok).toBe(true);
  });
  it("연속 활동 칭호만 업적 전용 아이템으로 지급할 수 있다", () => {
    const { econ, grants } = setup();
    expect(grants.issue(U, req({ txId: "act:m30", source: "activity-streak", coins: 200, gems: 5, items: ["title.streak30"] }), T0).ok).toBe(true);
    expect(econ.snapshot(U, T0).inventory.find((i) => i.id === "title.streak30")).toMatchObject({ via: "achievement" });
    expect(grants.issue(U, req({ txId: "act:fake", source: "activity-streak", coins: 0, items: ["title.300"] }), T0)).toMatchObject({ code: "ITEM" });
    expect(grants.issue(U, req({ txId: "sug:t-1", source: "suggestion", coins: 0, items: ["title.streak100"], actor: "admin:ops1" }), T0, { operator: true })).toMatchObject({ code: "ITEM" });
  });
});


describe("교환 코드", () => {
  const def = async (over: Partial<CodeDef> = {}): Promise<CodeDef> => ({
    id: "launch2026", hash: await hashCode("YACHT-2026-LAB"), coins: 100, gems: 5, start: T0 - 1, end: T0 + 86_400_000, maxRedemptions: 2, policyVersion: "CODE@0", label: "출시 기념 코드", ...over,
  });
  it("코드는 정규화 후 해시로만 비교하고, 계정당 한 번(code:<id>)만 지급한다", async () => {
    expect(normalizeCode(" yacht-2026 lab ")).toBe("YACHT2026LAB");
    const d = await def();
    expect(await hashCode("yacht 2026-lab")).toBe(d.hash);
    const { econ, grants } = setup();
    const c = checkCode(d, T0, { createdAt: T0 - 1000 }, 0);
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    expect(grants.issue(U, c.request, T0).ok).toBe(true);
    expect(grants.issue(U, c.request, T0 + 1)).toMatchObject({ ok: true, duplicate: true });
    expect(econ.snapshot(U, T0).wallet).toEqual({ coins: 300, gems: 25 });
  });
  it("기간·총 수량·가입 시점 조건을 확인한다", async () => {
    expect(checkCode(await def(), T0 - 10, { createdAt: 0 }, 0)).toMatchObject({ code: "NOT_STARTED" });
    expect(checkCode(await def(), T0 + 86_400_000, { createdAt: 0 }, 0)).toMatchObject({ code: "ENDED" });
    expect(checkCode(await def(), T0, { createdAt: 0 }, 2)).toMatchObject({ code: "SOLD_OUT" });
    expect(checkCode(await def({ accountCreatedBefore: T0 - 5000 }), T0, { createdAt: T0 - 100 }, 0)).toMatchObject({ code: "NOT_ELIGIBLE" });
    expect(checkCode(null, T0, { createdAt: 0 }, 0)).toMatchObject({ code: "UNKNOWN" });
  });
});

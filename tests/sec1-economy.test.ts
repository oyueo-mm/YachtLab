import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { EconomyStore, STALE_CODES, type EconSql } from "../worker/src/economy";
import { AccountStore } from "../worker/src/account";
import { parseQuote } from "../worker/src/accounts-api";
import { RewardGrants } from "../worker/src/grants";
import { RULES_ID, type MatchRecord } from "../src/identity/records";
import { ECONOMY } from "../src/economy/live/config";
import { itemById, priceOf, upgradeCost } from "../src/economy/live/catalog";
import { DRAW_COMBINATIONS, DRAW_COST, drawItems, drawOdds, enumerateDrawHands } from "../src/economy/live/draw";
import { ATTENDANCE, claimAttendance, newRetentionState } from "../src/economy/retention/policy";

/**
 * SEC-1 economy items folded into C5 (docs/audits/sec-1-2026-11-28, C4 SEC-08 / SEC-10):
 *  - upgrade `expectedLevel` checked inside the transaction (no unintended double upgrade)
 *  - stale purchase requests after a price / policy version change (409, nothing charged)
 *  - the draw odds the page shows = the odds the Worker draws with (versioned table)
 *  - request ids cannot be reused for a different purchase
 *  - only server-verified records settle rewards and count in public stats; a device import never
 *    pre-empts the server result (SEC-1-01 integration with the economy)
 *  - new reward grants stay idempotent under concurrent/duplicate delivery
 * Prices, rewards and odds are NOT changed by any of this.
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
const U = "u_" + "s".repeat(22);
const T0 = Date.parse("2026-12-02T12:00:00+09:00");
/** A store with a balance from grants only (operator source, test-only). */
function rich(coins = 20_000, gems = 2_000) {
  const db = sql();
  const econ = new EconomyStore(db);
  econ.init();
  econ.welcome(U, T0, null);
  const grants = new RewardGrants(db);
  grants.init();
  let n = 0;
  while (coins > 0 || gems > 0) {
    const c = Math.min(coins, 5000), g = Math.min(gems, 200);
    grants.issue(U, { txId: `op:test-${n++}`, source: "operator", coins: c, gems: g, policyVersion: "TEST", label: "테스트 잔액", actor: "admin:test", delivery: "direct" }, T0, { operator: true });
    coins -= c;
    gems -= g;
  }
  return { db, econ };
}
const ledgerIds = (econ: EconomyStore) => econ.snapshot(U, T0, 200).ledger.map((l) => l.id);

describe("SEC-08 강화 기대 단계", () => {
  it("두 화면이 같은 Lv.1에서 강화를 눌러도 한 번만 강화된다(두 번째는 LEVEL_CHANGED, 차감 없음)", () => {
    const { econ } = rich();
    expect(econ.buy(U, "dice.mint", "coins", "req-buy-mint", T0).ok).toBe(true);
    const cost = upgradeCost(itemById("dice.mint")!, 1)!;
    const a = econ.upgrade(U, "dice.mint", "req-tab-a-01", T0, { expectedLevel: 1, expectedPrice: cost });
    expect(a.ok).toBe(true);
    const coins = econ.snapshot(U, T0).wallet.coins;
    const b = econ.upgrade(U, "dice.mint", "req-tab-b-01", T0, { expectedLevel: 1, expectedPrice: cost });
    expect(b).toMatchObject({ ok: false, code: "LEVEL_CHANGED" });
    expect(econ.snapshot(U, T0).wallet.coins).toBe(coins);
    expect(econ.snapshot(U, T0).inventory.find((i) => i.id === "dice.mint")!.level).toBe(2);
    expect(ledgerIds(econ)).not.toContain("up:req-tab-b-01");
  });
  it("같은 요청의 재시도는 단계가 이미 올랐어도 원래 결과(duplicate)를 돌려준다", () => {
    const { econ } = rich();
    econ.buy(U, "dice.mint", "coins", "req-buy-mint", T0);
    econ.upgrade(U, "dice.mint", "req-up-same1", T0, { expectedLevel: 1 });
    expect(econ.upgrade(U, "dice.mint", "req-up-same1", T0 + 5, { expectedLevel: 1 })).toMatchObject({ ok: true, duplicate: true });
    expect(econ.snapshot(U, T0).inventory.find((i) => i.id === "dice.mint")!.level).toBe(2);
  });
  it("기대 단계를 보내지 않는 이전 화면은 기존처럼 동작한다(호환)", () => {
    const { econ } = rich();
    econ.buy(U, "dice.mint", "coins", "req-buy-mint", T0);
    expect(econ.upgrade(U, "dice.mint", "req-old-0001", T0).ok).toBe(true);
    expect(econ.upgrade(U, "dice.mint", "req-old-0002", T0).ok).toBe(true);
    expect(econ.snapshot(U, T0).inventory.find((i) => i.id === "dice.mint")!.level).toBe(3);
  });
});

describe("오래된 구매 요청 (가격·정책 버전)", () => {
  it("화면 가격이 서버 가격과 다르면 PRICE_CHANGED, 정책 버전이 다르면 POLICY_CHANGED — 아무것도 차감하지 않는다", () => {
    const { econ } = rich();
    const before = econ.snapshot(U, T0);
    const price = priceOf(itemById("dice.mint")!, "coins")!;
    expect(econ.buy(U, "dice.mint", "coins", "req-stale-p1", T0, { expectedPrice: price + 5 })).toMatchObject({ ok: false, code: "PRICE_CHANGED" });
    expect(econ.buy(U, "dice.mint", "coins", "req-stale-v1", T0, { configVersion: "M3i-W30@1" })).toMatchObject({ ok: false, code: "POLICY_CHANGED" });
    expect(econ.buySlot(U, "emote", "coins", "req-stale-s1", T0, { expectedPrice: 1 })).toMatchObject({ ok: false, code: "PRICE_CHANGED" });
    const after = econ.snapshot(U, T0);
    expect(after.wallet).toEqual(before.wallet);
    expect(after.inventory).toEqual(before.inventory);
    expect(after.ledger.length).toBe(before.ledger.length);
    // a fresh request with what the server quotes now goes through
    expect(econ.buy(U, "dice.mint", "coins", "req-fresh-01", T0, { expectedPrice: price, configVersion: ECONOMY.version }).ok).toBe(true);
    // a rejected id is still unused: it can carry the re-confirmed request
    expect(econ.buy(U, "dice.ink", "coins", "req-stale-p1", T0, { expectedPrice: priceOf(itemById("dice.ink")!, "coins")! }).ok).toBe(true);
    expect(econ.verify().ok).toBe(true);
  });
  it("이미 쓴 요청 ID를 다른 상품·통화·슬롯에 쓰면 REQUEST_REUSED (원 결과를 잘못 돌려주지 않는다)", () => {
    const { econ } = rich();
    expect(econ.buy(U, "dice.mint", "coins", "req-reuse-01", T0).ok).toBe(true);
    expect(econ.buy(U, "dice.ink", "coins", "req-reuse-01", T0)).toMatchObject({ ok: false, code: "REQUEST_REUSED" });
    expect(econ.buy(U, "dice.mint", "gems", "req-reuse-01", T0)).toMatchObject({ ok: false, code: "REQUEST_REUSED" });
    expect(econ.buy(U, "dice.mint", "coins", "req-reuse-01", T0)).toMatchObject({ ok: true, duplicate: true });
    expect(econ.upgrade(U, "dice.mint", "req-reuse-02", T0).ok).toBe(true);
    expect(econ.upgrade(U, "dice.ink", "req-reuse-02", T0)).toMatchObject({ ok: false, code: "REQUEST_REUSED" });
    expect(econ.buySlot(U, "emote", "coins", "req-reuse-03", T0).ok).toBe(true);
    expect(econ.buySlot(U, "chat", "coins", "req-reuse-03", T0)).toMatchObject({ ok: false, code: "REQUEST_REUSED" });
  });
  it("이 변경 전에 저장된 요청(지문 없음)은 기존처럼 duplicate로 답한다", () => {
    const { db, econ } = rich();
    econ.buy(U, "dice.mint", "coins", "req-legacy01", T0);
    db.exec("DELETE FROM econ_requests");
    expect(econ.buy(U, "dice.ink", "coins", "req-legacy01", T0)).toMatchObject({ ok: true, duplicate: true });
  });
  it("API: 견적 필드 형식 검사와 409 분류", () => {
    expect(parseQuote({})).toEqual({});
    expect(parseQuote({ expectedPrice: 300, expectedLevel: 2, configVersion: "M3i-W30@2", oddsVersion: "odds1-0a1b2c3d" })).toEqual({ expectedPrice: 300, expectedLevel: 2, configVersion: "M3i-W30@2", oddsVersion: "odds1-0a1b2c3d" });
    for (const bad of [{ expectedPrice: -1 }, { expectedPrice: 1.5 }, { expectedPrice: "300" }, { expectedLevel: 0 }, { configVersion: "<x>" }, { oddsVersion: "x".repeat(41) }]) expect(parseQuote(bad)).toBeNull();
    for (const code of ["PRICE_CHANGED", "LEVEL_CHANGED", "POLICY_CHANGED", "ODDS_CHANGED", "REQUEST_REUSED"]) expect(STALE_CODES.has(code)).toBe(true);
    expect(STALE_CODES.has("INSUFFICIENT")).toBe(false);
  });
});

describe("SEC-10 뽑기 확률표 버전", () => {
  it("확률표는 7,776 경우의 수와 실제 추첨 풀(drawItems)에서 만들어진다", () => {
    const odds = drawOdds("standard");
    expect(odds.tiers.reduce((a, t) => a + t.combos, 0)).toBe(DRAW_COMBINATIONS);
    const hands = enumerateDrawHands();
    expect(odds.tiers.find((t) => t.tier === "mythic")!.combos).toBe(hands.yacht);
    for (const t of odds.tiers) expect(t.items).toEqual(drawItems("standard", t.tier).map((i) => i.id).sort());
    expect(odds.cost).toBe(DRAW_COST);
  });
  it("현재 확률표 버전 고정 — 확률·풀·비용이 바뀌면 이 값과 공지·승인 절차를 함께 갱신해야 한다", () => {
    expect(drawOdds("standard").version).toBe("odds1-b39b8837");
    expect(drawOdds("christmas-2026").version).toBe("odds1-93f62a52");
  });
  it("서버 상태는 자기 확률표 버전을 알려 주고, 다른 버전으로 뽑으면 ODDS_CHANGED·차감 없음", () => {
    const { econ } = rich();
    expect(econ.drawStatus(T0).odds?.standard).toBe(drawOdds("standard").version);
    const before = econ.snapshot(U, T0).wallet;
    expect(econ.draw(U, "standard", "req-draw-odd1", T0, { oddsVersion: "odds1-00000000" })).toMatchObject({ ok: false, code: "ODDS_CHANGED" });
    expect(econ.draw(U, "standard", "req-draw-cost", T0, { expectedPrice: DRAW_COST + 1 })).toMatchObject({ ok: false, code: "PRICE_CHANGED" });
    expect(econ.snapshot(U, T0).wallet).toEqual(before);
    expect(econ.drawStatus(T0).remaining).toBe(5);
    const ok = econ.draw(U, "standard", "req-draw-good", T0, { oddsVersion: drawOdds("standard").version, expectedPrice: DRAW_COST, configVersion: ECONOMY.version });
    expect(ok.ok).toBe(true);
    expect(econ.verify().ok).toBe(true);
  });
});

describe("서버 검증 기록만 공식 보상·전적 (SEC-1-01 연동)", () => {
  const record = (id: string, over: Partial<MatchRecord> = {}): MatchRecord => ({
    recordId: id, mode: "online", rules: RULES_ID, source: "server", verification: "server-verified", kind: "random",
    startedAt: T0 - 600_000, endedAt: T0, name: "민수", score: 210, card: { yacht: 50 }, outcome: "loss", endReason: "completed",
    opponent: { name: "지민", kind: "member", score: 230, userId: "u_" + "o".repeat(22) }, ...over,
  } as MatchRecord);
  const setup = () => {
    const db = sql();
    const account = new AccountStore(db);
    account.init();
    account.ensureUser(U, "google", T0 - 86_400_000);
    const econ = new EconomyStore(db);
    econ.init();
    econ.welcome(U, T0, null);
    // the same order as UserStore.recordMatch: record + settlement in one transaction
    let settled = 0;
    const deliver = (r: MatchRecord) => db.transaction(() => account.recordMatch(r, () => {
      settled++;
      return econ.applyMatch(U, T0 - 86_400_000, { matchId: r.recordId, kind: r.kind ?? "friend", outcome: r.outcome, endReason: r.endReason, score: r.score, card: r.card, opponentUserId: r.opponent.userId, endedAt: r.endedAt }, T0).receipt;
    }));
    return { account, econ, deliver, settled: () => settled };
  };

  it("기기 기록 가져오기는 재화·퀘스트·업적을 정산하지 않고 공개 전적에도 들어가지 않는다", () => {
    const { account, econ } = setup();
    const before = econ.snapshot(U, T0);
    expect(account.importRecords([record("m_dev1", { outcome: "win" }), record("m_dev2", { outcome: "win" })], "device", T0)).toEqual({ added: 2, skipped: 0 });
    const after = econ.snapshot(U, T0);
    expect(after.wallet).toEqual(before.wallet);
    expect(after.state.daily).toEqual(before.state.daily);
    expect(after.ledger.some((l) => l.id.startsWith("m:"))).toBe(false);
    expect(account.publicProfile()!.online.games).toBe(0);
  });
  it("클라이언트가 server 출처를 주장해도 가져오기는 client-reported로 저장된다", () => {
    const { account } = setup();
    account.importRecords([record("m_fake", { source: "server", verification: "server-verified", outcome: "win" })], "device", T0);
    expect(account.records().find((r) => r.recordId === "m_fake")!.verification).toBe("client-reported");
    expect(account.publicProfile()!.online.games).toBe(0);
  });
  it("같은 matchId의 기기 기록을 먼저 올려도 서버 결과가 저장·정산되고(1회), 이후 재배달·재업로드가 바꾸지 못한다", () => {
    const { account, econ, deliver, settled } = setup();
    account.importRecords([record("m_live", { outcome: "win" })], "device", T0);
    expect(deliver(record("m_live"))).toBe(true);
    expect(settled()).toBe(1);
    const ids = econ.snapshot(U, T0, 200).ledger.filter((l) => l.id === "m:m_live");
    expect(ids).toHaveLength(1);
    const wallet = econ.snapshot(U, T0).wallet;
    const quests = econ.snapshot(U, T0).state.daily;
    expect(deliver(record("m_live"))).toBe(false);
    account.importRecords([record("m_live", { outcome: "win" })], "device", T0);
    expect(settled()).toBe(1);
    expect(econ.snapshot(U, T0).wallet).toEqual(wallet);
    expect(econ.snapshot(U, T0).state.daily).toEqual(quests);
    expect(account.publicProfile()!.online).toMatchObject({ games: 1, losses: 1, wins: 0 });
    expect(econ.verify().ok).toBe(true);
  });
  it("서버 검증이 아닌 기록은 정산 경로에 들어가지 않는다", () => {
    const { deliver, settled } = setup();
    expect(deliver(record("m_client", { source: "device", verification: "client-reported" }))).toBe(false);
    expect(settled()).toBe(0);
  });
});

describe("신규 보상 지급의 멱등성·동시성", () => {
  it("두 기기가 같은 날 출석을 동시에 수령해도(같은 상태에서 계산) 한 번만 지급된다", () => {
    const { econ } = rich(0, 0);
    const db = (econ as unknown as { sql: EconSql }).sql;
    const grants = new RewardGrants(db);
    grants.init();
    const state = newRetentionState();
    const a = claimAttendance(state, ATTENDANCE["ATT-150"], T0).grants[0];
    const b = claimAttendance(state, ATTENDANCE["ATT-150"], T0 + 1000).grants[0];
    expect(a.txId).toBe(b.txId);
    const req = (g: typeof a) => ({ txId: g.txId, source: "attendance" as const, coins: g.coins, gems: g.gems, policyVersion: "R-C5-CORE@0", label: g.label, actor: "system", delivery: "direct" as const });
    const r1 = grants.issue(U, req(a), T0);
    const r2 = grants.issue(U, req(b), T0 + 1000);
    expect(r1.ok && !r1.duplicate).toBe(true);
    expect(r2.ok && r2.duplicate).toBe(true);
    expect(econ.snapshot(U, T0, 200).ledger.filter((l) => l.id === `g:${a.txId}`)).toHaveLength(1);
    expect(econ.verify().ok && grants.verify().ok).toBe(true);
  });
  it("지급과 구매가 섞여도 원장 합계·행별 누적 잔액이 맞는다", () => {
    const { econ } = rich(5000, 100);
    const db = (econ as unknown as { sql: EconSql }).sql;
    const grants = new RewardGrants(db);
    grants.init();
    for (let i = 0; i < 20; i++) {
      grants.issue(U, { txId: `dp:${i}:done`, source: "daily-play", coins: 15, gems: 0, policyVersion: "R-C5-FULL@0", label: "오늘의 경기", actor: "system", delivery: "direct" }, T0 + i);
      if (i % 5 === 0) econ.buy(U, ["dice.mint", "bubble.mint", "profile.star", "title.rookie"][i / 5], "coins", `req-mix-${i}-buy`, T0 + i);
      grants.issue(U, { txId: `dp:${i}:done`, source: "daily-play", coins: 15, gems: 0, policyVersion: "R-C5-FULL@0", label: "오늘의 경기", actor: "system", delivery: "direct" }, T0 + i);
    }
    expect(econ.verify().ok).toBe(true);
    expect(grants.verify()).toMatchObject({ ok: true });
    expect(econ.snapshot(U, T0, 200).ledger.filter((l) => l.id.startsWith("g:dp:"))).toHaveLength(20);
  });
});

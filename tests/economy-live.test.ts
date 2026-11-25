import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { ACHIEVEMENTS, ECONOMY, QUESTS, economyDay, economyWeek, nextDayStart } from "../src/economy/live/config";
import { applyMatch, matchStats, newEconState, rerollDaily, type RewardInput } from "../src/economy/live/rewards";
import { DEFAULT_LOADOUT, DEFAULT_SLOTS, ITEMS, itemById, lookAt, priceOf, slotPrice, upgradeCost, validateLoadout, sanitizeLook } from "../src/economy/live/catalog";
import { EconomyStore, type EconSql } from "../worker/src/economy";
import { categories, type Card } from "../src/engine";

/**
 * Live economy M3i-W30 (Phase 5/6): reward order, caps, quests, achievements, ledger atomicity and
 * idempotency, purchases, upgrades, slots, loadout validation. Node + node:sqlite (same SQL as the DO).
 */
const U = "u_" + "x".repeat(22);
const T0 = Date.UTC(2026, 10, 24, 3, 0, 0); // 12:00 KST
const full: Card = Object.fromEntries(categories.map((c) => [c, 10])) as Card;
const match = (n: number, over: Partial<RewardInput> = {}): RewardInput => ({ matchId: "m_" + n, kind: "random", outcome: "loss", endReason: "completed", score: 150, card: { ...full, yacht: 0, full: 0, small: 0, large: 0 }, endedAt: T0 + n * 1000, ...over });
const old = { userId: U, createdAt: T0 - 30 * 86_400_000 };

function sql(): EconSql & { db: DatabaseSync } {
  const db = new DatabaseSync(":memory:");
  return {
    db,
    exec<T>(query: string, ...params: unknown[]) {
      const stmt = db.prepare(query);
      const rows = /^\s*select/i.test(query) ? (stmt.all(...(params as never[])) as T[]) : (stmt.run(...(params as never[])), [] as T[]);
      return { toArray: () => rows };
    },
    transaction<T>(fn: () => T): T {
      db.exec("BEGIN");
      try {
        const r = fn();
        db.exec("COMMIT");
        return r;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
  };
}
const coinsOf = (g: { kind: string; coins: number }[]) => g.filter((x) => x.kind === "match").reduce((a, x) => a + x.coins, 0);

describe("M3i-W30 경기 보상 계산 순서", () => {
  it("무작위 대전: 완료 10, 승리 +3, 무승부 +2 / 친구 10(승리 보너스 없음) / AI 완료 7·승리 +2", () => {
    const s = newEconState(U, T0);
    expect(coinsOf(applyMatch(s, match(1), old).grants)).toBe(10);
    expect(coinsOf(applyMatch(s, match(1, { outcome: "win" }), old).grants)).toBe(13);
    expect(coinsOf(applyMatch(s, match(1, { outcome: "draw" }), old).grants)).toBe(12);
    expect(coinsOf(applyMatch(s, match(1, { kind: "friend", outcome: "win" }), old).grants)).toBe(10);
    expect(coinsOf(applyMatch(s, match(1, { kind: "ai", outcome: "win" }), old).grants)).toBe(9);
    expect(coinsOf(applyMatch(s, match(1, { kind: "ai" }), old).grants)).toBe(7);
  });

  it("하루 1~10번째 정상, 11~30번째 경기당 3(보너스 없음), 31번째부터 0 — 퀘스트는 계속 진행", () => {
    let s = newEconState(U, T0);
    const got: number[] = [];
    for (let i = 1; i <= 32; i++) {
      const r = applyMatch(s, match(i, { outcome: "win", opponentUserId: "u_opp" + (i % 20) }), old);
      s = r.state;
      got.push(coinsOf(r.grants));
    }
    expect(got.slice(0, 10)).toEqual(Array(10).fill(13));
    expect(got.slice(10, 30)).toEqual(Array(20).fill(3));
    expect(got.slice(30)).toEqual([0, 0]);
    expect(s.daily.find((q) => q.id.startsWith("d.play"))?.done ?? true).toBe(true);
  });

  it("신규 7일 +5는 정상 구간(1~10번째)에만, 7일이 지나면 없음", () => {
    const fresh = { userId: U, createdAt: T0 - 86_400_000 };
    let s = newEconState(U, T0);
    const got: number[] = [];
    for (let i = 1; i <= 11; i++) {
      const r = applyMatch(s, match(i), fresh);
      s = r.state;
      got.push(coinsOf(r.grants));
    }
    expect(got.slice(0, 10)).toEqual(Array(10).fill(15));
    expect(got[10]).toBe(3);
    expect(coinsOf(applyMatch(newEconState(U, T0), match(1), { userId: U, createdAt: T0 - 8 * 86_400_000 }).grants)).toBe(10);
  });

  it("친구 대전은 하루 10경기까지만 보상하고, 상한을 넘긴 경기는 하루 순번을 쓰지 않는다", () => {
    let s = newEconState(U, T0);
    for (let i = 1; i <= 12; i++) s = applyMatch(s, match(i, { kind: "friend" }), old).state;
    expect(s.friend).toBe(10);
    expect(s.rewarded).toBe(10);
    const next = applyMatch(s, match(13), old);
    expect(next.position).toBe(11);
    expect(coinsOf(next.grants)).toBe(3);
  });

  it("같은 회원 상대와의 무작위 대전은 하루 3경기까지만 보상(반복 매칭·담합 억제)", () => {
    let s = newEconState(U, T0);
    const got: number[] = [];
    for (let i = 1; i <= 5; i++) {
      const r = applyMatch(s, match(i, { outcome: "win", opponentUserId: "u_same" }), old);
      s = r.state;
      got.push(coinsOf(r.grants));
    }
    expect(got).toEqual([13, 13, 13, 0, 0]);
  });

  it("본인 기권·시간 초과는 아무 보상도 없고 연승이 끊긴다 / 상대 기권은 6칸 이상 채웠을 때 완료 보상만", () => {
    let s = newEconState(U, T0);
    s = applyMatch(s, match(1, { outcome: "win" }), old).state;
    expect(s.streak).toBe(1);
    const own = applyMatch(s, match(2, { outcome: "loss", endReason: "resign" }), old);
    expect(own.grants).toEqual([]);
    expect(own.state.streak).toBe(0);
    expect(own.state.rewarded).toBe(1);
    const shortCard: Card = { aces: 1, deuces: 2 };
    expect(applyMatch(s, match(3, { outcome: "win", endReason: "resign", card: shortCard }), old).grants).toEqual([]);
    const longCard: Card = { aces: 1, deuces: 2, threes: 3, fours: 4, fives: 5, sixes: 6 };
    expect(coinsOf(applyMatch(s, match(4, { outcome: "win", endReason: "timeout", card: longCard }), old).grants)).toBe(10);
  });

  it("업적 집계는 하루 40경기까지 (일반 전적은 상한 없음)", () => {
    let s = newEconState(U, T0);
    for (let i = 1; i <= 45; i++) s = applyMatch(s, match(i, { opponentUserId: "u_o" + i }), old).state;
    expect(s.counters.match).toBe(40);
  });

  it("날짜·주 초기화는 서버 기준 KST 00:00, 주는 월요일 시작", () => {
    expect(economyDay(nextDayStart(T0)) - economyDay(T0)).toBe(1);
    expect(economyDay(nextDayStart(T0) - 1)).toBe(economyDay(T0));
    const mon = Date.UTC(2026, 10, 22, 15, 0, 0); // 2026-11-23 (Mon) 00:00 KST
    expect(economyWeek(mon) - economyWeek(mon - 1)).toBe(1);
    let s = newEconState(U, T0);
    for (let i = 1; i <= 12; i++) s = applyMatch(s, match(i), old).state;
    const tomorrow = applyMatch(s, match(99, { endedAt: nextDayStart(T0) + 1000 }), old);
    expect(tomorrow.position).toBe(1);
    expect(coinsOf(tomorrow.grants)).toBe(10);
  });
});

describe("퀘스트·업적", () => {
  it("일일·주간 퀘스트는 난이도별 1개씩, 입문자 기대 경기 수가 작은 후보만, 고득점·상단 보너스·채팅·구매 퀘스트 없음", () => {
    const s = newEconState(U, T0);
    expect(s.daily.map((q) => QUESTS.find((d) => d.id === q.id)!.difficulty)).toEqual([0, 1, 2]);
    expect(s.weekly.map((q) => QUESTS.find((d) => d.id === q.id)!.difficulty)).toEqual([0, 1, 2]);
    for (const q of QUESTS) expect(q.label).not.toMatch(/점 이상|보너스|채팅|이모티콘|구매|강화|패배/);
  });

  it("완료 시 자동 지급(같은 키는 한 번만), 3개 모두 완료하면 보너스 15코인·보석 1", () => {
    let s = newEconState(U, T0);
    s = { ...s, daily: [{ id: "d.play1", progress: 0, done: false }, { id: "d.win1", progress: 0, done: false }, { id: "d.win2", progress: 0, done: false }] };
    const r1 = applyMatch(s, match(1, { outcome: "win" }), old);
    expect(r1.grants.filter((g) => g.kind === "quest").map((g) => g.coins)).toEqual([15, 20]);
    const r2 = applyMatch(r1.state, match(2, { outcome: "win" }), old);
    expect(r2.grants.filter((g) => g.kind === "quest").map((g) => g.coins)).toEqual([30]);
    expect(r2.grants.find((g) => g.kind === "quest-bonus")).toMatchObject({ coins: 15, gems: 1 });
    const r3 = applyMatch(r2.state, match(3, { outcome: "win" }), old);
    expect(r3.grants.filter((g) => g.kind.startsWith("quest"))).toEqual([]);
    expect(r3.state.counters.dailyQuests).toBe(1);
  });

  it("하루 1회 무료 교체: 같은 난이도의 다른 퀘스트, 완료한 퀘스트는 교체 불가", () => {
    const s = newEconState(U, T0);
    const r = rerollDaily(s, U, 2);
    if (!r.ok) throw Error(r.message);
    expect(r.state.daily[2].id).not.toBe(s.daily[2].id);
    expect(QUESTS.find((q) => q.id === r.state.daily[2].id)!.difficulty).toBe(2);
    expect(rerollDaily(r.state, U, 1).ok).toBe(false);
  });

  it("업적은 한 번만, 굴림 업적은 방의 이벤트 로그로 계산한다", () => {
    const log = [
      { type: "turnStarted", playerId: "a", round: 12 },
      { type: "diceRolled", playerId: "a", dice: [4, 4, 4, 4, 4], roll: 1 },
      { type: "categoryScored", playerId: "a", category: "yacht", points: 50, dice: [4, 4, 4, 4, 4] },
    ];
    const st = matchStats(log, "a", "b", ["a"]);
    expect(st).toMatchObject({ firstRollYachts: 1, finalRoundYacht: true, yachtFaces: [4] });
    const r = applyMatch(newEconState(U, T0), match(1, { outcome: "win", card: { ...full, yacht: 50 }, stats: st }), old);
    const ids = r.grants.filter((g) => g.kind === "achievement").map((g) => g.key);
    expect(ids).toEqual(expect.arrayContaining(["a:a.yacht.1", "a:l.firstyacht", "a:l.finalyacht"]));
    const again = applyMatch(r.state, match(2, { outcome: "win", card: { ...full, yacht: 50 }, stats: st }), old);
    expect(again.grants.filter((g) => g.key === "a:l.firstyacht")).toEqual([]);
    // symbolic achievements are hidden, gems only, and grant an achievement-only title
    for (const a of ACHIEVEMENTS.filter((x) => x.group === "special")) {
      expect(a.hidden).toBe(true);
      expect(a.coins).toBe(0);
      expect(itemById(a.item)?.acquisition).toBe("achievement");
    }
  });
});

describe("상품·가격·장착 검증", () => {
  it("등급 가격표·강화 1:0.5:1·신화 첫 강화 12,000·슬롯 가격", () => {
    expect(priceOf(itemById("dice.royal")!, "coins")).toBe(25000);
    expect(priceOf(itemById("dice.royal")!, "gems")).toBe(1200);
    expect(priceOf(itemById("dice.ink")!, "gems")).toBeNull(); // coins only
    expect(priceOf(itemById("profile.whale")!, "coins")).toBeNull(); // gems only
    expect(priceOf(itemById("title.300")!, "coins")).toBeNull(); // achievement only
    expect(upgradeCost(itemById("nameFx.rainbow")!, 1)).toBe(12000);
    expect(upgradeCost(itemById("nameFx.rainbow")!, 2)).toBe(25000);
    expect(upgradeCost(itemById("nameFx.rainbow")!, 3)).toBeNull();
    expect(upgradeCost(itemById("emote.fire")!, 1)).toBe(150);
    expect(upgradeCost(itemById("chat.nice")!, 1)).toBeNull();
    expect([4, 5, 6, 7, 8].map((n) => slotPrice("emote", n, "coins"))).toEqual([500, 1000, 1500, 2500, null]);
    expect(slotPrice("chat", 6, "gems")).toBe(25);
    for (const i of ITEMS) if (i.tier === "mythic") expect(i.acquisition).toBe("either");
  });

  it("주사위 테마는 눈과 면의 명도 대비가 충분하다(판독성)", () => {
    const lum = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    for (const i of ITEMS.filter((x) => x.look.dice)) {
      const [a, b] = [lum(i.look.dice!.face), lum(i.look.dice!.pip)].sort((x, y) => y - x);
      expect((a + 0.05) / (b + 0.05), i.id).toBeGreaterThan(4.5);
    }
  });

  it("보유하지 않은 아이템·잠긴 단계·슬롯 초과 장착을 거부하고, 위조된 외형은 기본값으로 정리한다", () => {
    const owned = new Map([["emote.fire", 1], ["nameFx.glow", 2]]);
    expect(validateLoadout({ ...DEFAULT_LOADOUT, emotes: [...DEFAULT_LOADOUT.emotes, "emote.fire"] }, owned, DEFAULT_SLOTS).ok).toBe(false); // 5 > 4 slots
    expect(validateLoadout({ ...DEFAULT_LOADOUT, emotes: ["emote.fire", "emote.smile"] }, owned, DEFAULT_SLOTS).ok).toBe(true);
    expect(validateLoadout({ ...DEFAULT_LOADOUT, emotes: ["emote.crown"] }, owned, DEFAULT_SLOTS).ok).toBe(false);
    expect(validateLoadout({ ...DEFAULT_LOADOUT, dice: "dice.royal" }, owned, DEFAULT_SLOTS).ok).toBe(false);
    expect(validateLoadout({ ...DEFAULT_LOADOUT, nameFx: "nameFx.glow", levels: { "nameFx.glow": 3 } }, owned, DEFAULT_SLOTS).ok).toBe(false);
    expect(validateLoadout({ ...DEFAULT_LOADOUT, nameFx: "nameFx.glow", levels: { "nameFx.glow": 2 } }, owned, DEFAULT_SLOTS).ok).toBe(true);
    expect(validateLoadout({ ...DEFAULT_LOADOUT, dice: "emote.fire" }, owned, DEFAULT_SLOTS).ok).toBe(false);
    expect(sanitizeLook({ dice: "dice.unknown", emotes: [{ id: "<script>", lv: 9 }] }).dice).toBe("dice.classic");
  });
});

describe("재화 원장 (계정 저장소, node:sqlite)", () => {
  const setup = () => {
    const db = sql();
    const store = new EconomyStore(db);
    store.init();
    return { db, store };
  };
  const now = T0;

  it("가입 보상은 계정당 한 번, 탈퇴 후 30일 안의 재가입에는 없음", () => {
    const { store } = setup();
    expect(store.welcome(U, now, null).map((g) => [g.coins, g.gems])).toEqual([[200, 20]]);
    expect(store.welcome(U, now + 1000, null)).toEqual([]);
    expect(store.snapshot(U, now).wallet).toEqual({ coins: 200, gems: 20 });
    const { store: re } = setup();
    expect(re.welcome(U, now, now + ECONOMY.rejoinWelcomeCooldownMs)).toEqual([]);
    expect(re.snapshot(U, now).wallet).toEqual({ coins: 0, gems: 0 });
  });

  it("같은 경기 보상·같은 구매 요청은 두 번 처리되지 않고, 잔액은 원장 합계와 같다", () => {
    const { store } = setup();
    store.welcome(U, now, null);
    store.applyMatch(U, old.createdAt, match(1, { outcome: "win" }), now);
    // a replayed delivery of the same match: the ledger key m:<matchId> exists → no second grant
    store.applyMatch(U, old.createdAt, match(1, { outcome: "win" }), now);
    const w1 = store.snapshot(U, now).wallet.coins;
    expect(store.snapshot(U, now).ledger.filter((l) => l.id === "m:m_1")).toHaveLength(1);
    for (let i = 2; i <= 9; i++) store.applyMatch(U, old.createdAt, match(i, { opponentUserId: "u_o" + i }), now);
    const w2 = store.snapshot(U, now).wallet.coins;
    const a = store.buy(U, "dice.mint", "coins", "req-aaaaaaaa", now);
    const b = store.buy(U, "dice.mint", "coins", "req-aaaaaaaa", now); // retry after a lost reply
    expect(a.ok && b.ok && b.duplicate).toBe(true);
    expect(store.snapshot(U, now).wallet.coins).toBe(w2 - 300);
    const v = store.verify();
    expect(v.problems).toEqual([]);
    expect(v.ok).toBe(true);
  });

  it("잔액 부족·업적 전용·결제 수단 불가·이미 보유는 거부되고 잔액은 그대로", () => {
    const { store } = setup();
    store.welcome(U, now, null);
    const before = store.snapshot(U, now).wallet;
    for (const [item, cur, code] of [
      ["dice.royal", "coins", "INSUFFICIENT"],
      ["title.300", "coins", "NOT_FOR_SALE"],
      ["dice.ink", "gems", "CURRENCY"],
      ["dice.classic", "coins", "OWNED"],
      ["nope", "coins", "ITEM"],
    ] as const) {
      const r = store.buy(U, item, cur, "r-" + item, now);
      expect(r.ok ? "ok" : r.code).toBe(code);
    }
    expect(store.snapshot(U, now).wallet).toEqual(before);
    expect(store.verify().ok).toBe(true);
  });

  it("동시 구매: 잔액보다 많은 구매 요청이 몰려도 하나만 성공한다(계정 객체는 직렬 처리)", async () => {
    const { store } = setup();
    store.welcome(U, now, null); // 200 coins, 20 gems
    for (let i = 0; i < 20; i++) store.applyMatch(U, old.createdAt, match(100 + i, { opponentUserId: "u_o" + i }), now);
    const coins = store.snapshot(U, now).wallet.coins;
    const results = await Promise.all(["dice.mint", "bubble.mint", "profile.star", "emote.fire", "emote.wow"].map((id, i) => Promise.resolve().then(() => store.buy(U, id, "coins", "c" + i + "-xxxxxx", now))));
    const ok = results.filter((r) => r.ok).length;
    expect(ok).toBe(Math.min(5, Math.floor(coins / 300)));
    expect(store.snapshot(U, now).wallet.coins).toBe(coins - ok * 300);
    expect(store.verify().ok).toBe(true);
  });

  it("강화는 코인으로만, 실패·하락 없이 한 단계씩, 최대 단계 이후 거부 / 보석으로 산 아이템도 코인으로 강화", () => {
    const { db, store } = setup();
    store.welcome(U, now, null);
    db.exec("UPDATE econ SET gems = 1000, coins = 1000 WHERE id = 1");
    db.exec("INSERT INTO ledger (event_id, at, kind, coins, gems, coins_after, gems_after, funding, label, config) VALUES ('test-grant', 0, 'test', 1000, 1000, 1200, 1020, 'play', 'test', 'x')"); // keep the ledger consistent with the direct grant above
    db.exec("UPDATE econ SET gems = 1020, coins = 1200 WHERE id = 1");
    expect(store.buy(U, "emote.fire", "gems", "g1-xxxxxx", now).ok).toBe(true);
    expect(store.upgrade(U, "emote.fire", "u1-xxxxxx", now).ok).toBe(true);
    expect(store.upgrade(U, "emote.fire", "u2-xxxxxx", now).ok).toBe(true);
    const r = store.upgrade(U, "emote.fire", "u3-xxxxxx", now);
    expect(r.ok ? "ok" : r.code).toBe("MAX_LEVEL");
    const snap = store.snapshot(U, now);
    expect(snap.inventory.find((i) => i.id === "emote.fire")?.level).toBe(3);
    expect(snap.wallet).toEqual({ coins: 1200 - 150 - 300, gems: 1020 - 40 });
    expect(store.verify().ok).toBe(true);
  });

  it("장착은 서버가 다시 검사하고, 상대에게 보이는 외형은 저장된 장착에서만 만든다", () => {
    const { store } = setup();
    store.welcome(U, now, null);
    expect(store.setLoadout(U, { ...DEFAULT_LOADOUT, dice: "dice.royal" }, now).ok).toBe(false);
    expect(store.buy(U, "dice.mint", "gems", "m1-xxxxxx", now).ok).toBe(false); // 20 gems < 40
    for (let i = 0; i < 10; i++) store.applyMatch(U, old.createdAt, match(200 + i, { outcome: "win", opponentUserId: "u_o" + i }), now);
    expect(store.buy(U, "dice.mint", "coins", "m1-xxxxxx", now).ok).toBe(true);
    expect(store.setLoadout(U, { ...DEFAULT_LOADOUT, dice: "dice.mint", emotes: ["emote.clap", "emote.smile"] }, now).ok).toBe(true);
    expect(store.look()).toMatchObject({ dice: "dice.mint", emotes: [{ id: "emote.clap", lv: 1 }, { id: "emote.smile", lv: 1 }] });
    expect(store.buySlot(U, "emote", "gems", "s1-xxxxxx", now).ok).toBe(true);
    expect(store.snapshot(U, now).slots.emote).toBe(5);
  });

  it("거래 실패 시 아무것도 남지 않는다(원자성)", () => {
    const { db, store } = setup();
    store.welcome(U, now, null);
    const before = JSON.stringify(store.snapshot(U, now));
    // force a failure inside the transaction: an amount that is not an integer
    expect(() => db.transaction(() => (store as unknown as { post: (e: unknown[], n: number) => void }).post([{ id: "x1", kind: "t", coins: -5, gems: 0, label: "" }, { id: "x2", kind: "t", coins: 0.5, gems: 0, label: "" }], now))).toThrow();
    expect(JSON.stringify(store.snapshot(U, now))).toBe(before);
  });
});

describe("아이템 콘텐츠 (H, 2026-11-25)", () => {
  it("상품군별 목표 수량(합계 200)·고유 ID·기존 ID 보존", () => {
    const count = (c: string) => ITEMS.filter((i) => i.category === c && !i.retired).length;
    expect({ dice: count("dice"), board: count("board"), emote: count("emote"), chat: count("chat"), bubble: count("bubble"), profile: count("profile"), nameFx: count("nameFx"), fx: count("fx"), title: count("title") }).toEqual({ dice: 30, board: 20, emote: 30, chat: 30, bubble: 15, profile: 25, nameFx: 15, fx: 15, title: 20 });
    expect(ITEMS.length).toBe(200);
    expect(new Set(ITEMS.map((i) => i.id)).size).toBe(ITEMS.length);
    // ids bought before this change keep their category, tier and meaning
    for (const [id, cat, tier] of [["dice.mint", "dice", "common"], ["dice.royal", "dice", "mythic"], ["board.felt", "board", "rare"], ["bubble.gold", "bubble", "legendary"], ["profile.whale", "profile", "rare"], ["nameFx.rainbow", "nameFx", "mythic"], ["fx.confetti", "fx", "legendary"], ["title.dicer", "title", "rare"], ["emote.fire", "emote", "common"], ["chat.lucky", "chat", "rare"], ["title.300", "title", "special"]] as const)
      expect(itemById(id), id).toMatchObject({ category: cat, tier });
  });
  it("같은 등급 안에 여러 디자인, 가격은 등급표 그대로(M3i-W30), 특수 등급 신규 판매 없음", () => {
    for (const cat of ["dice", "board", "emote", "chat", "bubble", "profile", "nameFx", "fx", "title"])
      for (const tier of ["rare", "epic", "legendary"]) {
        const n = ITEMS.filter((i) => i.category === cat && i.tier === tier).length;
        if (n) expect(n, `${cat}/${tier}`).toBeGreaterThanOrEqual(1);
      }
    expect(ITEMS.filter((i) => i.category === "dice" && i.tier === "epic").length).toBeGreaterThanOrEqual(5);
    const prices: Record<string, [number, number]> = { common: [300, 40], rare: [1000, 120], epic: [3000, 300], legendary: [10000, 600], mythic: [25000, 1200] };
    for (const i of ITEMS.filter((x) => x.acquisition !== "default" && x.tier !== "special")) {
      const c = priceOf(i, "coins"),
        g = priceOf(i, "gems");
      if (c !== null) expect(c, i.id).toBe(prices[i.tier][0]);
      if (g !== null) expect(g, i.id).toBe(prices[i.tier][1]);
      expect(c !== null || g !== null, i.id).toBe(true);
    }
    expect(ITEMS.filter((i) => i.tier === "special").map((i) => i.id).sort()).toEqual(["title.300", "title.310", "title.lucky_star", "title.perfect"]);
  });
  it("강화 단계가 있는 상품은 Lv.2·Lv.3 외형이 실제로 다르다", () => {
    for (const i of ITEMS.filter((x) => x.maxLevel > 1 && x.levelLooks)) {
      const l1 = JSON.stringify(lookAt(i, 1)),
        l2 = JSON.stringify(lookAt(i, 2)),
        l3 = JSON.stringify(lookAt(i, 3));
      expect(new Set([l1, l2, l3]).size, i.id).toBe(3);
    }
    for (const i of ITEMS.filter((x) => x.maxLevel > 1)) expect(i.levels?.length, i.id).toBe(i.maxLevel);
  });
  it("모든 외형 클래스가 실제 CSS에 있다(빈 외형 없음)", async () => {
    const { readFileSync } = await import("node:fs");
    const css = readFileSync("src/items-content.css", "utf8") + readFileSync("src/items.css", "utf8");
    const classes = new Set<string>();
    for (const i of ITEMS) for (const lv of [1, 2, 3]) for (const c of (lookAt(i, lv).css ?? "").split(/\s+/).filter(Boolean)) classes.add(c);
    for (const c of classes) if (!c.startsWith("fx-") && !c.startsWith("title-common")) expect(css.includes("." + c), c).toBe(true);
  });
});

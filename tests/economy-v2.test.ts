/**
 * Economy v2 research (C1) — the research engine must reproduce the live economy exactly before any
 * candidate is compared, and settlement boundaries are pinned. Research only: nothing here changes
 * src/economy/live or the Worker.
 */
import { describe, expect, it } from "vitest";
import { categories, type Card } from "../src/engine";
import { ECONOMY, economyDay } from "../src/economy/live/config";
import { ITEMS, priceOf, upgradeCost } from "../src/economy/live/catalog";
import { enumerateDrawHands, HANDS } from "../src/economy/live/draw";
import { applyMatch, newEconState, type EconState, type RewardInput } from "../src/economy/live/rewards";
import { applyMatchV2, newExt, type V2Ext } from "../src/economy/v2/engine";
import { baselineParams, scaleMatch } from "../src/economy/v2/params";
import { CONFIRMED_TIER_MAP, DRAW_TIER_P, PROPOSED_BOARD_MAP, drawPools, pricedCatalog } from "../src/economy/v2/catalog";
import { BOOSTERS, MAIN_PERSONAS, POLICIES, SINGLE, cand } from "../src/economy/v2/candidates";
import { simulateUser, type LegacyWarmups } from "../src/economy/v2/sim";
import { mulberry32 } from "../src/economy/rng";

const DAY = 86_400_000;
/** KST midnight of 2026-11-30 (a Monday) in UTC ms. */
const T0 = Date.UTC(2026, 10, 29, 15, 0, 0);
const account = { userId: "u-test", createdAt: T0 - 30 * DAY };
const fullCard = (over: Partial<Card> = {}): Card => ({ ...Object.fromEntries(categories.map((c) => [c, 5])), ...over }) as Card;
const input = (i: number, over: Partial<RewardInput> = {}): RewardInput => ({ matchId: `m${i}`, kind: "random", outcome: "loss", endReason: "completed", score: 150, card: fullCard(), opponentUserId: `o${i}`, endedAt: T0 + 12 * 3600_000 + i * 60_000, ...over });

function both(s: EconState, x: V2Ext, inp: RewardInput, acc = account, p = baselineParams()) {
  const live = applyMatch(s, inp, acc);
  const v2 = applyMatchV2(s, x, inp, acc, p);
  return { live, v2 };
}
function run(seq: RewardInput[], acc = account) {
  let s = newEconState(acc.userId, seq[0]?.endedAt ?? T0);
  let x = newExt();
  return seq.map((inp) => {
    const { live, v2 } = both(s, x, inp, acc);
    expect(v2.state).toEqual(live.state);
    expect(v2.grants).toEqual(live.grants);
    expect([v2.countable, v2.rewarded, v2.position, v2.reason]).toEqual([live.countable, live.rewarded, live.position, live.reason]);
    s = live.state;
    x = v2.ext;
    return live;
  });
}
const matchCoins = (o: ReturnType<typeof applyMatch>) => o.grants.filter((g) => g.kind === "match").reduce((a, g) => a + g.coins, 0);

describe("경제 v2 연구 엔진 — 현행 M3i-W30@2 기준선 재현", () => {
  it("기준 파라미터는 운영 설정에서 그대로 읽는다(버전 M3i-W30@2, 이벤트 없음)", () => {
    expect(ECONOMY.version).toBe("M3i-W30@2");
    expect(ECONOMY.events.length).toBe(0); // the research engine has no event branch; it must stay empty for parity
    const b = baselineParams();
    expect(b.match).toEqual(ECONOMY.match);
    expect(b.daily).toEqual(ECONOMY.daily);
    expect(b.newUser).toEqual(ECONOMY.newUser);
    expect(b.draw).toEqual({ cost: 250, duplicateCoins: 25, dailyLimit: 5 });
  });

  it("무작위 4,000경기(모드·결과·기권·상대·자정·신규 7일 경계 포함)에서 지급·상태가 운영 applyMatch와 완전히 같다", () => {
    const r = mulberry32(20261127);
    const acc = { userId: "u-prop", createdAt: T0 - 6 * DAY - 3 * 3600_000 }; // boost ends inside the run
    let t = T0 - 2 * 3600_000;
    const seq: RewardInput[] = [];
    for (let i = 0; i < 4000; i++) {
      t += Math.floor(r() * 25 * 60_000) + 60_000;
      const kind = (["random", "random", "friend", "ai"] as const)[Math.floor(r() * 4)];
      const er = r();
      const endReason = er < 0.05 ? "resign" : er < 0.1 ? "left" : er < 0.12 ? "timeout" : "completed";
      const oc = r();
      const outcome = endReason === "resign" || endReason === "timeout" ? (r() < 0.5 ? "loss" : "win") : endReason === "left" ? "win" : oc < 0.01 ? "draw" : oc < 0.5 ? "win" : "loss";
      const filled = endReason === "completed" ? 12 : 1 + Math.floor(r() * 11);
      const card: Card = {};
      categories.slice(0, filled).forEach((c) => (card[c] = r() < 0.3 ? 0 : 1 + Math.floor(r() * 30)));
      if (r() < 0.1) card.yacht = 50;
      if (r() < 0.05) card.sixes = 30;
      seq.push({
        matchId: `p${i}`, kind, outcome: outcome as RewardInput["outcome"], endReason: endReason as RewardInput["endReason"], score: 60 + Math.floor(r() * 220), card,
        opponentUserId: kind === "random" ? `o${Math.floor(r() * 6)}` : undefined,
        stats: { firstRollYachts: r() < 0.01 ? 1 + Math.floor(r() * 2) : 0, firstRollLarge: r() < 0.1 ? 1 : 0, finalRoundYacht: r() < 0.01, yachtFaces: r() < 0.1 ? [1 + Math.floor(r() * 6)] : [], comeback30: r() < 0.03 },
        endedAt: t,
      });
    }
    const out = run(seq, acc);
    expect(out.filter((o) => o.reason === "daily-cap").length).toBeGreaterThan(0);
    expect(out.filter((o) => o.reason === "same-opponent-cap").length).toBeGreaterThan(0);
    expect(out.filter((o) => o.reason === "friend-cap").length).toBeGreaterThan(0);
  });

  it("정산 경계: 하루 10번째 전액, 11번째·30번째 3코인, 31번째 0(퀘스트는 계속)", () => {
    const out = run(Array.from({ length: 32 }, (_, i) => input(i, { outcome: "win" })));
    const coins = out.map(matchCoins);
    expect(coins[9]).toBe(13); // 10 + win 3 (existing member, no boost)
    expect(coins[10]).toBe(3);
    expect(coins[29]).toBe(3);
    expect(coins[30]).toBe(0);
    expect(out[30].reason).toBe("daily-cap");
    expect(out[30].countable).toBe(true);
  });

  it("정산 경계: 친구 11번째·같은 상대 4번째는 순번을 쓰지 않는다", () => {
    const friends = Array.from({ length: 11 }, (_, i) => input(i, { kind: "friend", opponentUserId: undefined }));
    const same = Array.from({ length: 4 }, (_, i) => input(100 + i, { opponentUserId: "same" }));
    const out = run([...friends, ...same, input(200)]);
    expect(out[10].reason).toBe("friend-cap");
    expect(out[14].reason).toBe("same-opponent-cap");
    expect(out[15].position).toBe(14); // 10 friend + 3 same + this one
  });

  it("정산 경계: 상대 기권 시 5칸은 미집계, 6칸은 완료 보상만(승리 보너스 없음)", () => {
    const part = (n: number) => Object.fromEntries(categories.slice(0, n).map((c) => [c, 5])) as Card;
    const out = run([input(0, { outcome: "win", endReason: "left", card: part(5) }), input(1, { outcome: "win", endReason: "left", card: part(6) })]);
    expect(out[0].countable).toBe(false);
    expect(matchCoins(out[1])).toBe(10);
  });

  it("정산 경계: 신규 +5는 가입 후 정확히 7일 전까지, 경계 시각부터 없음", () => {
    const created = T0 - 7 * DAY + 13 * 3600_000; // boost ends at T0 + 13:00
    const acc = { userId: "u-new", createdAt: created };
    const out = run([input(0, { endedAt: created + 7 * DAY - 1 }), input(1, { endedAt: created + 7 * DAY })], acc);
    expect(matchCoins(out[0])).toBe(15);
    expect(matchCoins(out[1])).toBe(10);
  });

  it("정산 경계: KST 자정 직전·직후에 하루 순번과 일일 퀘스트가 초기화된다", () => {
    const seq = Array.from({ length: 31 }, (_, i) => input(i, { endedAt: T0 + DAY - 40 * 60_000 + i * 60_000 }));
    seq.push(input(99, { endedAt: T0 + DAY })); // 00:00:00.000 KST next day
    const out = run(seq);
    expect(economyDay(T0 + DAY - 1)).toBe(economyDay(T0));
    expect(out[30].reason).toBe("daily-cap");
    expect(out[31].position).toBe(1);
    expect(matchCoins(out[31])).toBe(10);
  });
});

describe("경제 v2 연구 카탈로그 — 가격·강화·뽑기 재현과 등급 재분류", () => {
  it("기준 파라미터에서 243개 상품의 코인·보석 가격과 강화 비용이 운영 priceOf/upgradeCost와 같다", () => {
    const cat = pricedCatalog(baselineParams());
    expect(cat.length).toBe(ITEMS.filter((i) => !i.retired).length);
    for (const c of cat) {
      const item = ITEMS.find((i) => i.id === c.id)!;
      expect(c.coins).toBe(priceOf(item, "coins"));
      expect(c.gems).toBe(priceOf(item, "gems"));
      const a = upgradeCost(item, 1), b = upgradeCost(item, 2);
      expect(c.up).toEqual(a === null || b === null ? null : [a, b]);
    }
  });

  it("뽑기 등급 확률은 7,776개 주사위 전수 열거와 같다", () => {
    const hands = enumerateDrawHands();
    const exp: Record<string, number> = {};
    for (const [h, n] of Object.entries(hands)) exp[HANDS[h as keyof typeof HANDS].tier] = (exp[HANDS[h as keyof typeof HANDS].tier] ?? 0) + n / 7776;
    for (const t of Object.keys(exp)) expect(DRAW_TIER_P[t as keyof typeof DRAW_TIER_P]).toBeCloseTo(exp[t], 12);
    const pools = drawPools(pricedCatalog(baselineParams()));
    expect([pools.common.length, pools.rare.length, pools.epic.length, pools.legendary.length, pools.mythic.length]).toEqual([57, 48, 46, 27, 12]);
  });

  it("등급 재분류는 ID·수량·상품군·획득 방식을 보존하고 지정 상품의 등급만 바꾼다", () => {
    for (const map of ["confirmed", "confirmed+proposed"] as const) {
      const cat = pricedCatalog({ ...baselineParams(), tierMap: map });
      expect(cat.map((c) => c.id)).toEqual(pricedCatalog(baselineParams()).map((c) => c.id));
      for (const c of cat) {
        const mapped = CONFIRMED_TIER_MAP[c.id] ?? (map === "confirmed+proposed" ? PROPOSED_BOARD_MAP[c.id] : undefined);
        expect(c.tier).toBe(mapped ?? c.liveTier);
      }
    }
    const t = pricedCatalog({ ...baselineParams(), tierMap: "confirmed" });
    const get = (id: string) => t.find((c) => c.id === id)!;
    expect(get("dice.gold").coins).toBe(10000); // mythic 25,000 → legendary
    expect(get("dice.thunder").coins).toBe(25000);
    expect(get("emote.sleepy").coins).toBe(7500); // common 225 → legendary emote price (75 %)
    expect(get("emote.whale").coins).toBe(225);
  });

  it("가격·강화 배율은 코인 5 단위, 보석 1 단위로 내림하고 0이 되지 않는다", () => {
    const half = pricedCatalog(cand("t", "t", "t", { priceMult: { common: 0.5, rare: 0.5, epic: 0.5, legendary: 0.5, mythic: 0.5 }, upgradeMult: { common: 0.5, rare: 0.5, epic: 0.5, legendary: 0.5, mythic: 0.5 } }));
    for (const c of half) {
      if (c.coins !== null) expect(c.coins % 5).toBe(0), expect(c.coins).toBeGreaterThan(0);
      if (c.gems !== null) expect(c.gems).toBeGreaterThan(0);
      if (c.up) expect(c.up[0] % 5 + (c.up[1] ?? 0) % 5).toBe(0);
    }
    expect(half.find((c) => c.id === "dice.royal")!.coins).toBe(12500);
  });
});

describe("경제 v2 연구 후보 — 정산 경계(부스터·연승)", () => {
  const p = cand("B", "t", "t", (b) => ({ match: scaleMatch(b, 1) }));
  it("부스터는 전액 구간(1~10번째)의 경기 보상에만, 하루 추가 상한까지 별도 원장 키로 붙는다", () => {
    let s = newEconState(account.userId, T0);
    let x = newExt();
    const day = economyDay(T0 + 12 * 3600_000);
    let total = 0;
    const kinds: string[] = [];
    for (let i = 0; i < 12; i++) {
      const fullBand = s.rewarded < p.daily.fullMatches;
      const o = applyMatchV2(s, x, input(i, { outcome: "win" }), account, p, fullBand ? { mult: 2, dailyExtraCap: 50, day } : null);
      s = o.state;
      x = o.ext;
      total += o.boostCoins;
      kinds.push(...o.grants.filter((g) => g.kind === "booster").map((g) => g.key));
    }
    expect(total).toBe(50); // 13 extra per match, capped at 50 for the day
    expect(new Set(kinds).size).toBe(kinds.length);
    expect(kinds.every((k) => k.startsWith("b:"))).toBe(true);
  });

  it("부스터: 본인 기권·미집계 경기에는 없음, 날짜가 바뀌면 하루 상한이 새로 시작된다", () => {
    const s = newEconState(account.userId, T0);
    const day = economyDay(T0 + 12 * 3600_000);
    const own = applyMatchV2(s, newExt(), input(0, { endReason: "resign", outcome: "loss" }), account, p, { mult: 2, dailyExtraCap: 100, day });
    expect(own.boostCoins).toBe(0);
    const ext: V2Ext = { ...newExt(), boostDay: day, boostExtraToday: 100 };
    const capped = applyMatchV2(s, ext, input(1), account, p, { mult: 2, dailyExtraCap: 100, day });
    expect(capped.boostCoins).toBe(0);
    const next = applyMatchV2(s, ext, input(2, { endedAt: T0 + DAY + 3600_000 }), account, p, { mult: 2, dailyExtraCap: 100, day: day + 1 });
    expect(next.boostCoins).toBe(10);
  });

  it("주간 최고 연승 보상은 단계마다 주 1회, 다음 주에 다시 시작", () => {
    const sp = cand("S", "t", "t", { streakWeekly: { thresholds: [3, 5, 8], coins: [15, 30, 50] } });
    let s = newEconState(account.userId, T0);
    let x = newExt();
    const keys: string[] = [];
    const seq = [...Array.from({ length: 5 }, (_, i) => input(i, { outcome: "win" })), input(5), ...Array.from({ length: 5 }, (_, i) => input(10 + i, { outcome: "win" })), ...Array.from({ length: 3 }, (_, i) => input(20 + i, { outcome: "win", endedAt: T0 + 7 * DAY + i * 60_000 }))];
    for (const m of seq) {
      const o = applyMatchV2(s, x, m, account, sp);
      s = o.state;
      x = o.ext;
      keys.push(...o.grants.filter((g) => g.kind === "streak").map((g) => g.key));
    }
    expect(keys.length).toBe(3); // week 1: 3 and 5 once each; week 2: 3
  });
});

describe("경제 v2 시뮬레이터", () => {
  const opts = { days: 7, warmupDays: 0, snapshots: [1, 7], includeRev2: true, t0: T0 };
  it("같은 시드는 같은 결과, 다른 시드는 다른 결과(재현성)", () => {
    const a = simulateUser(MAIN_PERSONAS[2], baselineParams(), 7, 3, opts);
    const b = simulateUser(MAIN_PERSONAS[2], baselineParams(), 7, 3, opts);
    const c = simulateUser(MAIN_PERSONAS[2], baselineParams(), 8, 3, opts);
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(c));
  });
  it("잔액은 음수가 되지 않고, 발행 − 소각 = 잔액(신규 사용자)", () => {
    for (const p of [baselineParams(), ...POLICIES]) {
      const r = simulateUser(MAIN_PERSONAS[4], p, 1, 0, opts);
      const s = r.snapshots[1];
      expect(s.coins).toBeGreaterThanOrEqual(0);
      expect(s.coinsEarned - s.spent.item - s.spent.upgrade - s.spent.draw).toBe(s.coins);
    }
  });
  it("하루 8시간 사용자는 감소 구간·30경기 상한 도달 일이 집계된다(지표 회귀 방지)", () => {
    const r = simulateUser(MAIN_PERSONAS[5], baselineParams(), 1, 0, opts);
    expect(r.snapshots[1].daysReduced).toBeGreaterThan(0);
    expect(r.snapshots[1].daysCapped).toBeGreaterThan(0);
  });
  it("후보 ID는 고유하고 부스터 후보에 미도입이 포함된다", () => {
    const ids = [...SINGLE, ...POLICIES].map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(BOOSTERS[0].booster.kind).toBe("none");
  });
});

describe("C1 독립 감사 경계", () => {
  it("두 주의 매일 KST 자정 경계에서 퀘스트·업적·승리와 원장 키가 일치한다", () => {
    const inputs: RewardInput[] = [];
    for (let d = 0; d < 16; d++) {
      const midnight = T0 + d * DAY;
      for (const [i, offset] of [-1, 0, 1, 6000, 15000, 21000].entries()) {
        inputs.push(input(inputs.length, { endedAt: midnight + offset, opponentUserId: `repeat-${i % 2}`, outcome: "win", card: fullCard({ yacht: 50, full: 25, large: 30 }) }));
      }
    }
    const settled = run(inputs);
    const grantKeys = settled.flatMap((r) => r.grants.map((g) => g.key));
    expect(new Set(grantKeys).size).toBe(grantKeys.length);
    expect(grantKeys.some((k) => k.startsWith("qb:weekly:"))).toBe(true);
    expect(grantKeys).toContain("a:a.match.10");
    expect(settled[1].state.day).toBe(settled[0].state.day + 1);
    expect(settled[1].state.week).toBe(settled[0].state.week + 1);
    expect(settled[2].state.lastPlayDay).toBe(settled[1].state.lastPlayDay);
  });

  it("활성 이벤트 시작 포함·종료 제외, 감소 및 상한에서도 완료 보너스는 한 번 지급한다", () => {
    const event = { id: "audit-fixture", label: "fixture", start: T0, end: T0 + 100, perMatch: 9, minMatches: 31, reward: { coins: 21, gems: 2 } };
    let s = newEconState(account.userId, T0 - 1);
    let ext = newExt();
    const before = applyMatchV2(s, ext, input(99, { endedAt: T0 - 1 }), account, baselineParams(), null, [event]);
    expect(before.grants.find((g) => g.kind === "match")?.coins).toBe(10);
    const actual = [];
    for (let i = 0; i < 34; i++) {
      const next = applyMatchV2(s, ext, input(i, { endedAt: i < 33 ? T0 + i : event.end }), account, baselineParams(), null, [event]);
      actual.push(next);
      s = next.state;
      ext = next.ext;
    }
    expect(actual[0].grants.find((g) => g.kind === "match")?.coins).toBe(19);
    expect(actual[10].grants.find((g) => g.kind === "match")?.coins).toBe(3);
    expect(actual[30].grants.filter((g) => g.kind === "match")).toEqual([]);
    expect(actual.flatMap((r) => r.grants.filter((g) => g.kind === "event")).map((g) => g.key)).toEqual(["e:audit-fixture"]);
    expect(s.events[event.id]).toEqual({ matches: 33, paid: true });
  });

  it("Rev.1 보드 비용, 보유권을 보존하는 채팅 가상 전환 및 Lv.1 전용을 검증한다", () => {
    const p = baselineParams();
    const index = (items: ReturnType<typeof pricedCatalog>) => new Map(items.map((i) => [i.id, i]));
    const r1 = index(pricedCatalog(p, { revision: 1, audited: true }));
    const r2 = index(pricedCatalog(p, { revision: 2, audited: true }));
    expect(r1.has("dice.thunder")).toBe(false);
    expect(r2.get("dice.thunder")!.drawable).toBe(false);
    expect(r1.get("board.wood_oak")).toMatchObject({ maxLevel: 1, up: null, coins: r2.get("board.wood_oak")!.coins });
    expect(r2.get("board.wood_oak")).toMatchObject({ maxLevel: 3 });
    for (const id of ["board.felt", "board.navy"]) {
      expect(r1.get(id)).toMatchObject({ maxLevel: 1, up: null });
      expect(r2.get(id)!.maxLevel).toBe(3);
    }
    expect(r1.get("board.marble")!.up).toEqual([1350, 2700]);
    const chat = pricedCatalog(p, { revision: 2, proposedChat: true, audited: true });
    const sale = chat.filter((i) => i.category === "chat" && !i.season && i.coins !== null);
    expect(sale).toHaveLength(38);
    expect(sale.filter((i) => i.drawable && i.maxLevel === 1 && i.up === null)).toHaveLength(38);
    expect(index(chat).get("chat.great")).toMatchObject({ tier: "rare", coins: 550 });
    expect(index(chat).get("chat.great")!.defaultOwned).toBeUndefined();
    const grandfathered = pricedCatalog(p, { revision: 2, proposedChat: true, audited: true, grandfatherLegacyFreeChat: true });
    expect(index(grandfathered).get("chat.great")!.defaultOwned).toBe(true);
    expect(index(chat).get("chat.congrats")).toMatchObject({ id: "chat.congrats", coins: 165 });
    expect(index(chat).get("chat.learn")).toMatchObject({ coins: null, drawable: false });
  });

  it("교정된 견적은 부동소수점 오차로 90보석의 70%를 62보석으로 내리지 않는다", () => {
    const base = baselineParams();
    const p = { ...base, priceMult: { ...base.priceMult, rare: 0.7 } };
    expect(pricedCatalog(p, { audited: true }).find((item) => item.id === "emote.dice")!.gems).toBe(63);
    expect(pricedCatalog(p).find((item) => item.id === "emote.dice")!.gems).toBe(62);
  });

  it("30일 초과 코인/보석 보존, 보유 업적 및 서로 다른 시각의 전역 AI 제한과 계정 제한을 검증한다", () => {
    const p = baselineParams();
    const template = MAIN_PERSONAS.find((x) => x.minutesPerDay === 240)!;
    const a = { ...template, modeMix: { ai: 1 }, startHour: 18, matchMinutes: { ...template.matchMinutes, ai: 1 }, ownForfeit: 0, aiClosesAt: 8 };
    const opts = { days: 35, snapshots: [1, 7, 30, 35], warmupDays: 0, includeRev2: true, audited: true, t0: T0, initialCoins: 9500, initialGems: 35 };
    const capped = simulateUser(a, p, 111, 0, opts).snapshots.at(-1)!;
    expect(capped.audit!.eligibleAiStarts).toBe(0);
    expect(capped.audit!.aiDenied).toBeGreaterThan(0);
    expect(capped.paidMatches).toBe(0);
    const normal = simulateUser({ ...a, aiClosesAt: undefined }, p, 111, 0, opts).snapshots.at(-1)!;
    expect(normal.audit!.eligibleAiStarts).toBe(30 * opts.days);
    expect(normal.audit!.aiDenied).toBeGreaterThan(0);
    expect(normal.daysCapped).toBe(opts.days);
    expect(normal.coins).toBe(opts.initialCoins + normal.audit!.netCoins);
    expect(normal.gems).toBe(opts.initialGems + normal.audit!.netGems);
    expect(normal.audit!.purchases).toBeGreaterThan(2);
    expect(capped.bySource.achievement).toBeGreaterThan(0); // only acquisition achievements are reachable with no eligible matches
    expect(normal.audit!.purchaseTimes).toEqual([...normal.audit!.purchaseTimes].sort((a, b) => a - b));
  });
});


it("기존 사용자 워밍업 캐시 재사용 후에도 후보별 원시 결과가 독립 실행과 완전히 일치한다", () => {
  const p = MAIN_PERSONAS[3];
  const warmupParams = baselineParams();
  const opts = { days: 30, warmupDays: 60, warmupParams, snapshots: [1, 7, 30], includeRev2: true, t0: T0 };
  const cache: LegacyWarmups = [];
  for (const candidate of [warmupParams, ...POLICIES, SINGLE.find((x) => x.id === "TIER1")!]) {
    expect(simulateUser(p, candidate, 771651, 7, opts, cache)).toEqual(simulateUser(p, candidate, 771651, 7, opts));
  }
});

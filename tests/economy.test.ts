import { describe, expect, it } from "vitest";
import { binomTail, couponCdf, couponExpectedMatches, firstRollProbability, turnTargetProbability, gamePatternProbability, score } from "../src/economy/dice-exact";
import { ACHIEVEMENTS, QUESTS, REJECTED_QUESTS, achievementGems, eventProbability, TIER_IDS } from "../src/economy/content";
import { MODELS, MODE_TRUST, scaleCoins, modelById } from "../src/economy/models";
import { PERSONAS, personaById } from "../src/economy/personas";
import { CURVE_PRESETS, DEFAULT_CATALOG, buildCatalog, derivePrices, deriveSlots, niceRound, upgradeCosts, curveMultiplier } from "../src/economy/pricing";
import { DEFAULT_WIN_RATE, simulateUser, type SimContext } from "../src/economy/simulate";
import { dailyUsage } from "../src/economy/cloudflare";
import { mulberry32, gini, summary } from "../src/economy/rng";
import exactPmf from "../src/economy/data/exact-score-pmf.json";
import matchEvents from "../src/economy/data/match-events.json";

const prices = derivePrices(100, 4);
const ctx = (modelId: string, extra: Partial<SimContext> = {}): SimContext => ({
  model: modelById(modelId), catalog: buildCatalog(DEFAULT_CATALOG, prices, 400, 1), upgrade: CURVE_PRESETS[1], slots: deriveSlots(100, 4),
  gemValueInCoins: 25, winRate: DEFAULT_WIN_RATE, achievementGems: Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, 10])), spending: true, ...extra,
});

describe("경제 연구 — 정확 확률", () => {
  it("한 굴림 요트 6/7776, 한 턴 최적 요트 ≈ 4.6029%", () => {
    expect(firstRollProbability((m) => m.every((v) => v === m[0]))).toBeCloseTo(6 / 7776, 12);
    expect(turnTargetProbability((m) => m.every((v) => v === m[0]))).toBeCloseTo(0.046029, 5);
  });
  it("이항 꼬리와 쿠폰 수집 기대값", () => {
    expect(binomTail(12, 1 / 1296, 1)).toBeCloseTo(1 - (1295 / 1296) ** 12, 12);
    expect(couponExpectedMatches([0.5, 0.5])).toBeCloseTo(3, 10); // two equal coupons in one draw each: 1/0.5+1/0.5-1/1
    expect(couponCdf([1 / 6, 1 / 6, 1 / 6, 1 / 6, 1 / 6, 1 / 6], 1000)).toBeCloseTo(1, 6);
  });
  it("게임 패턴 DP: 모든 칸 아무 주사위 허용이면 확률 1", () => {
    const any = () => true;
    expect(gamePatternProbability({ aces: any, deuces: any, threes: any, fours: any, fives: any, sixes: any, choice: any, four: any, full: any, small: any, large: any, yacht: any })).toBeCloseTo(1, 12);
    expect(score([6, 6, 6, 5, 5], "full")).toBe(28);
  }, 20000);
  it("DP Expert 정확 점수 분포의 평균은 DP 테이블 값과 같다", () => {
    expect(exactPmf.check.mass).toBeCloseTo(1, 9);
    expect(Math.abs(exactPmf.check.mean - 191.760879752165)).toBeLessThan(1e-9);
    const tail = exactPmf.tailAtLeast as Record<string, number>;
    expect(tail["323"]).toBeGreaterThan(0);
    expect(tail["300"]).toBeLessThan(tail["290"]);
  });
  it("실제 경기 데이터는 정확 분포와 일치(전문가 200점 이상)", () => {
    const mc = matchEvents.mirror.expert.events.t200;
    const exact = (exactPmf.tailAtLeast as Record<string, number>)["200"];
    expect(exact).toBeGreaterThanOrEqual(mc.ci95[0] - 0.005);
    expect(exact).toBeLessThanOrEqual(mc.ci95[1] + 0.005);
  });
});

describe("경제 연구 — 정책 경계", () => {
  it("클라이언트 기록 모드는 반례 M0 외의 모든 모델에서 공식 재화를 주지 않는다", () => {
    expect(MODE_TRUST.local_ai).toBe("client-reported");
    expect(MODE_TRUST.local_pvp).toBe("client-reported");
    for (const m of MODELS.filter((x) => !x.counterfactual)) {
      const forger = personaById("abuse_forge_local");
      const u = simulateUser(ctx(m.id, { spending: false, forceLoggedIn: true, forceF2P: true }), forger, 0, 30, 7);
      expect(u.coinsBySource.match + u.coinsBySource.quest_daily + u.coinsBySource.quest_weekly + u.coinsBySource.achievement).toBe(0);
    }
  });
  it("게스트(비로그인)는 공식 재화를 받지 않는다", () => {
    const u = simulateUser(ctx("M3", { forceLoggedIn: false }), personaById("regular"), 0, 60, 3);
    expect(u.loggedIn).toBe(false);
    expect(Object.values(u.coinsBySource).reduce((a, b) => a + b, 0)).toBe(0);
  });
  it("과금 유도·고의 패배·도배 퀘스트는 후보에 없다", () => {
    expect(QUESTS.some((q) => /패배|구매|강화|이모티콘|채팅/.test(q.label))).toBe(false);
    expect(REJECTED_QUESTS.length).toBeGreaterThanOrEqual(5);
    expect(QUESTS.filter((q) => q.period === "daily").every((q) => q.key !== "win" || q.count <= 2)).toBe(true);
  });
  it("업적 전용(상징) 아이템은 업적에만 있고 보석 보상은 상한이 있다", () => {
    expect(ACHIEVEMENTS.some((a) => a.symbolic)).toBe(true);
    expect(achievementGems(1e12)).toBeLessThanOrEqual(100);
    expect(achievementGems(10)).toBeLessThan(achievementGems(1000));
  });
});

describe("경제 연구 — 시뮬레이터", () => {
  it("같은 시드는 같은 결과(재현성)", () => {
    const a = simulateUser(ctx("M3"), personaById("heavy"), 5, 120, 11, { checkpoints: [30, 120] });
    const b = simulateUser(ctx("M3"), personaById("heavy"), 5, 120, 11, { checkpoints: [30, 120] });
    expect(a).toEqual(b);
    const c = simulateUser(ctx("M3"), personaById("heavy"), 5, 120, 12, { checkpoints: [30, 120] });
    expect(c.coins).not.toBe(a.coins);
  });
  it("잔액 = 획득 − 소비 (원장 보존)", () => {
    for (const p of PERSONAS) {
      const u = simulateUser(ctx("M3"), p, 1, 200, 5);
      const earned = Object.values(u.coinsBySource).reduce((x, y) => x + y, 0), spent = Object.values(u.coinsSpent).reduce((x, y) => x + y, 0);
      expect(u.coins).toBeCloseTo(earned - spent, 6);
      expect(u.coins).toBeGreaterThanOrEqual(0);
      expect(u.gems).toBeGreaterThanOrEqual(0);
      expect(u.emoteSlots).toBeLessThanOrEqual(8);
      expect(u.chatSlots).toBeLessThanOrEqual(10);
    }
  });
  it("하루 보상 경기 상한은 봇의 경기 코인을 제한한다", () => {
    const bot = personaById("abuser");
    const capped = simulateUser(ctx("M3", { spending: false, forceLoggedIn: true }), bot, 0, 10, 9);
    const uncapped = simulateUser(ctx("M1", { spending: false, forceLoggedIn: true, model: scaleCoins(modelById("M1"), 0.5) }), bot, 0, 10, 9);
    expect(capped.coinsBySource.match).toBeLessThan(uncapped.coinsBySource.match / 3);
  });
  it("이벤트 확률은 숙련도가 높을수록 높다(200점 이상)", () => {
    const ps = TIER_IDS.map((t) => eventProbability(t, "t200"));
    for (let i = 1; i < ps.length; i++) expect(ps[i]).toBeGreaterThan(ps[i - 1]);
  });
});

describe("경제 연구 — 가격·강화·서버", () => {
  it("강화 비용은 단계가 높을수록 증가하고 기하급수가 선형보다 가파르다", () => {
    for (const cfg of CURVE_PRESETS) {
      const c = upgradeCosts(10000, { ...cfg, maxLevel: 5 });
      for (let i = 1; i < c.length; i++) expect(c[i]).toBeGreaterThan(c[i - 1]);
    }
    expect(curveMultiplier("exponential", 4, 3)).toBeGreaterThan(curveMultiplier("linear", 4, 1));
  });
  it("가격은 등급 순으로 증가하고 보기 좋은 숫자로 반올림된다", () => {
    for (let k = 1; k < 5; k++) { expect(prices.coin[k]).toBeGreaterThan(prices.coin[k - 1]); expect(prices.gem[k]).toBeGreaterThan(prices.gem[k - 1]); }
    expect(niceRound(1234)).toBe(1200);
    expect(deriveSlots(100, 4).costs).toHaveLength(4);
  });
  it("Cloudflare 사용량: 경제 처리는 쓰기를 더하고 무료 한도 비율을 계산한다", () => {
    const a = dailyUsage({ online_random: 600, online_friend: 0, server_ai: 0 }, 0, 0);
    const b = dailyUsage({ online_random: 600, online_friend: 0, server_ai: 0 }, 600, 10);
    expect(a.rowWrites).toBe(300 * 120);
    expect(b.rowWrites).toBeGreaterThan(a.rowWrites);
    expect(b.utilization.rowWrites).toBeCloseTo(b.rowWrites / 70000, 9);
  });
  it("통계 도우미", () => {
    expect(gini([1, 1, 1, 1])).toBeCloseTo(0, 9);
    expect(gini([0, 0, 0, 10])).toBeCloseTo(0.75, 9);
    expect(summary([3, 1, 2]).median).toBe(2);
    expect(mulberry32(1)()).toBe(mulberry32(1)());
  });
});

import { integerM3, INTEGER_MODELS } from "../src/economy/models";
import { ACTIVE_QUESTS } from "../src/economy/content";
import { STEP_RATIOS } from "../src/economy/pricing";
import { RECURRING_SOURCES, ONE_TIME_SOURCES, SOURCES } from "../src/economy/simulate";

describe("경제 추가 검증 — 정수안·정책 후보", () => {
  it("정수 운영안의 모든 지급량은 정수이고 승리 보너스 비율 변형을 가진다", () => {
    for (const m of INTEGER_MODELS) {
      const vals = [...Object.values(m.match).flatMap((r) => [r.complete, r.win, r.draw]), ...m.quests.dailyCoins, ...m.quests.weeklyCoins, m.quests.dailyAllBonus.coins, m.quests.weeklyAllBonus.coins, m.newUser.coins, m.events.rewardCoins, m.afterSoftCapFlat ?? 0, m.boostPerMatch ?? 0, m.eventPerMatch ?? 0, m.achievementCoinPerGem];
      for (const v of vals) expect(Number.isInteger(v)).toBe(true);
    }
    expect(INTEGER_MODELS.map((m) => m.match.online_random.win)).toEqual([7, 3, 2, 1]);
    expect(integerM3(0.3).match.online_friend.win).toBe(0);
  });
  it("상단 보너스 관련 퀘스트·업적은 보류되어 활성 목록에서 빠진다", () => {
    expect(ACTIVE_QUESTS().some((q) => q.key === "upperBonus")).toBe(false);
    expect(ACHIEVEMENTS.filter((a) => a.key === "upperBonus" || a.key === "upperPerfectPath").every((a) => a.onHold)).toBe(true);
    const u = simulateUser(ctx("M3", { forceLoggedIn: true, forceF2P: true }), personaById("heavy"), 0, 400, 2);
    expect(u.achievements.some((id) => id.startsWith("a.bonus") || id === "s.perfectpath")).toBe(false);
  });
  it("수급처는 반복·일회성·결제로 빠짐없이 나뉘고 연차 원장의 합이 전체와 같다", () => {
    expect(new Set([...RECURRING_SOURCES, ...ONE_TIME_SOURCES, "purchase"]).size).toBe(SOURCES.length);
    const u = simulateUser(ctx("M3"), personaById("regular"), 3, 800, 4);
    for (const s of SOURCES) expect(u.coinsYear[s].reduce((a, b) => a + b, 0)).toBeCloseTo(u.coinsBySource[s], 6);
  });
  it("게스트 소급: 소급 없음이면 0, 상한이 있으면 상한 이하", () => {
    const guest = { ...personaById("regular"), loggedInShare: 1, payer: null };
    const none = simulateUser(ctx("M3", { model: { ...integerM3(0.3), guestCarryoverDays: 0 }, loginDay: 20, spending: false }), guest, 0, 40, 1);
    expect(none.coinsBySource.guest_carryover).toBe(0);
    const capped = simulateUser(ctx("M3", { model: { ...integerM3(0.3), guestCarryoverDays: 1e9, guestCarryoverMatchCap: 20 }, loginDay: 20, spending: false }), guest, 0, 40, 1);
    expect(capped.guestMatchesCredited).toBeLessThanOrEqual(20);
    expect(capped.coinsBySource.guest_carryover).toBeGreaterThan(0);
  });
  it("보석으로 산 신화의 강화: '구매 재화' 정책이면 보석, 기본은 코인으로 강화한다", () => {
    const focus = { ...personaById("heavy"), spend: "focus" as const, focusCurrency: "gem" as const, upgradeAppetite: 1, goalShare: 0, wantByRarity: [0, 0, 0, 0, 0] as [number, number, number, number, number], payer: null };
    const base = { forceF2P: true, forceLoggedIn: true, gemValueInCoins: 25 };
    const same = simulateUser(ctx("M3", { ...base, upgradeCurrency: "same" }), focus, 0, 1500, 6);
    const coin = simulateUser(ctx("M3", { ...base, upgradeCurrency: "coin" }), focus, 0, 1500, 6);
    expect(same.gemsSpent.item).toBeGreaterThan(0);
    expect(same.coinsSpent.upgrade).toBe(0);
    expect(coin.gemsSpent.upgrade).toBe(0);
  });
  it("강화 비율 지정: 가격 × 비율, 단계가 오를수록 비싸다", () => {
    for (const r of STEP_RATIOS) {
      const c = upgradeCosts(10000, { curve: "linear", baseFraction: 1, maxLevel: 3, param: 1, steps: r.steps });
      expect(c[1]).toBeGreaterThan(c[0]);
    }
    expect(upgradeCosts(25000, { curve: "linear", baseFraction: 1, maxLevel: 3, param: 1, steps: [0.5, 1.5] })).toEqual([12000, 40000]);
  });
  it("출시 시점에 등급마다 허용된 결제 경로(코인·보석·선택)가 최소 1개씩 있다", () => {
    const cat = buildCatalog(DEFAULT_CATALOG, prices, 10, 99);
    for (let k = 0; k < 5; k++) for (const [i, cur] of (["coin", "gem", "either"] as const).entries()) {
      if (prices.currencyMix[k][i] > 0) expect(cat.some((it) => it.rarity === k && it.releaseDay === 0 && it.currency === cur)).toBe(true);
    }
  });
});

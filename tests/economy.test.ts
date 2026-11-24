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

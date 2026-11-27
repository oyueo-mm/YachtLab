import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AccountError } from "../src/identity/account-client";
import { buildTimeline, COMEBACK, formatDuration, rewardView, summarize, type ResultInput } from "../src/match-result/model";
import { SCENARIOS, playedGame } from "../src/match-result/fixtures";
import { resultSoundPlan } from "../src/match-result/result-sfx";
import { maxUpper, zeroScored, zeroScoreNotice } from "../src/match-result/zero-score";
import { resolveReward, RECEIPT_RETRY_MS } from "../src/match-result/useRewardState";
import { fromOnline, stepsFromCards } from "../src/match-result/adapters";
import { MatchResultPanel } from "../src/match-result/MatchResultPanel";
import type { OnlineEvent } from "../src/online/protocol";

const scenario = (id: string) => SCENARIOS.find((s) => s.id === id)!.input;
const quest = (id: string) => (id === "d.win1" ? { label: "1승", period: "daily" as const, count: 1 } : id === "d.play3" ? { label: "경기 3회 완료", period: "daily" as const, count: 3 } : undefined);

describe("A3 outcome classes", () => {
  it.each([
    ["grand", "win", "승리"],
    ["loss", "loss", "패배"],
    ["draw", "draw", "무승부"],
    ["forfeit", "forfeit-win", "승리"],
    ["forfeit-loss", "forfeit-loss", "기권패"],
    ["field", "rank", "공동 2위"],
    ["solo", "solo-best", "최고 기록 갱신!"],
    ["solo-first", "solo-first", "첫 기록 완성"],
  ])("%s → %s", (id, kind, title) => {
    const s = summarize(scenario(id));
    expect(s.outcome.kind).toBe(kind);
    expect(s.outcome.title).toBe(title);
  });
  it("observer view (local 2-player) names the winner without a 'you' seat", () => {
    const input = scenario("loss");
    const s = summarize({ ...input, seats: input.seats.map((x) => ({ ...x, you: false })) });
    expect(s.outcome.kind).toBe("observer");
    expect(s.outcome.title).toBe("AI · 매우 어려움 승리");
  });
});

describe("A3 comeback criterion (actual score order only)", () => {
  it.each([
    ["grand", "grand-comeback"],
    ["comeback", "comeback"],
    ["final-turn", "final-turn"],
    ["close", "close"],
    ["loss", null],
    ["draw", null],
    ["forfeit", null],
  ])("%s → %s", (id, drama) => {
    expect(summarize(scenario(id)).drama).toBe(drama);
  });
  it("timeline rebuilds the final cards; per-round deficits include the upper bonus at that moment", () => {
    const s = summarize(scenario("grand"));
    expect(s.timeline.status).toBe("ok");
    expect(s.comeback?.deficits.find((d) => d.round === 9)?.deficit).toBe(70);
    expect(s.highlights[0]).toMatchObject({ id: "grand-comeback", detail: "8라운드 81점 차를 뒤집었어요" });
  });
  it("an early deficit does not hide a later qualifying one", () => {
    const s = summarize(scenario("comeback"));
    expect(s.comeback!.deficits.filter((d) => d.round >= COMEBACK.round).some((d) => d.deficit >= COMEBACK.deficit)).toBe(true);
    expect(s.highlights[0].detail).toBe("7라운드 25점 차를 뒤집었어요");
  });
  it("no score order → no comeback claim (close win is still judged from the final score)", () => {
    expect(summarize({ ...scenario("grand"), steps: null }).drama).toBeNull();
    expect(summarize({ ...scenario("close"), steps: null }).drama).toBe("close");
  });
  it("a score order that does not match the final cards is rejected", () => {
    const input = scenario("grand");
    const steps = input.steps!.map((st, i) => (i === 0 ? { ...st, points: 5 } : st));
    const s = summarize({ ...input, steps });
    expect(s.timeline.status).toBe("invalid");
    expect(s.drama).toBeNull();
    expect(buildTimeline(input.seats, [...input.steps!, input.steps![0]]).status).toBe("invalid");
  });
  it("a forfeit win never gets comeback or close drama", () => {
    const g = playedGame([
      { id: "me", name: "나", you: true, seq: [["choice", 10]] },
      { id: "op", name: "상대", forfeited: "resign", seq: [["choice", 30]] },
    ]);
    expect(summarize({ mode: "online", ...g, winners: ["me"] }).drama).toBeNull();
  });
});

describe("A3 highlights only from the actual cards and verified inputs", () => {
  it("yacht/large/bonus come from the card; round is the seat's own scoring order", () => {
    const h = summarize(scenario("grand")).highlights.map((x) => x.id);
    expect(h).toEqual(expect.arrayContaining(["yacht", "large", "personal-best", "streak"]));
    expect(h).not.toContain("bonus");
    expect(summarize(scenario("grand")).highlights.find((x) => x.id === "yacht")?.detail).toBe("11번째 기록");
  });
  it("a zero in yacht or large is not a highlight", () => {
    const h = summarize(scenario("loss")).highlights.map((x) => x.id);
    expect(h).not.toContain("yacht");
    expect(h).not.toContain("large");
    expect(h).not.toContain("bonus"); // 상단 57점
    expect(summarize(scenario("close")).highlights.map((x) => x.id)).toContain("bonus");
  });
  it("no personal-best or streak without data, and streak only on a win", () => {
    const base = scenario("comeback");
    expect(summarize(base).highlights.map((x) => x.id)).not.toContain("personal-best");
    const lost = scenario("loss");
    expect(summarize({ ...lost, streak: { current: 4, best: 4 } }).highlights.map((x) => x.id)).not.toContain("streak");
    expect(summarize({ ...base, streak: { current: 1, best: 3 } }).highlights.map((x) => x.id)).not.toContain("streak");
  });
  it("no analysis metrics appear anywhere", () => {
    for (const s of SCENARIOS) {
      const text = JSON.stringify(summarize(s.input));
      expect(text).not.toMatch(/정확도|실수|운 점수|luck|accuracy/i);
    }
  });
});

describe("A3 duration", () => {
  it("formats and hides implausible values", () => {
    expect(formatDuration(14 * 60_000 + 32_000)).toBe("14분 32초");
    expect(formatDuration(45_000)).toBe("45초");
    expect(formatDuration(0)).toBeNull();
    expect(formatDuration(-5)).toBeNull();
    expect(formatDuration(7 * 3600_000)).toBeNull();
    expect(summarize(scenario("draw")).duration).toBeNull();
  });
});

describe("A3 rewards are shown only from a settled server receipt", () => {
  it("pending / delayed / failed never show amounts", () => {
    for (const status of ["pending", "delayed", "failed"] as const) {
      const v = rewardView({ status }, quest);
      expect(v.kind).toBe("note");
      expect(JSON.stringify(v)).not.toMatch(/코인|보석/);
    }
  });
  it("settled receipt → exact deltas, completed quests and achievements", () => {
    const input = scenario("grand");
    const v = rewardView(input.rewards, quest);
    expect(v).toMatchObject({ kind: "settled", coins: 13, gems: 0 });
    if (v.kind !== "settled") throw new Error();
    expect(v.quests.find((q) => q.id === "d.win1")?.done).toBe(true);
    expect(v.grants).toEqual([{ label: "첫 요트", coins: 70, gems: 10, kind: "achievement" }]);
  });
  it("modes without rewards show nothing; guests see a sign-in note", () => {
    expect(rewardView({ status: "none", reason: "mode" }, quest).kind).toBe("hidden");
    expect(rewardView({ status: "none", reason: "guest" }, quest).kind).toBe("note");
  });
  it("receipt lookup: retries 404 then reports delay; other errors are failures", async () => {
    const waits: number[] = [];
    const wait = async (ms: number) => void waits.push(ms);
    const notYet = () => Promise.reject(new AccountError("NOT_FOUND", "x", 404));
    expect(await resolveReward(notYet, wait)).toEqual({ status: "delayed" });
    expect(waits).toEqual([...RECEIPT_RETRY_MS]);
    let n = 0;
    const later = () => (n++ < 1 ? notYet() : Promise.resolve({ before: { coins: 0, gems: 0 }, after: { coins: 10, gems: 0 }, quests: [], grants: [] }));
    expect((await resolveReward(later, wait)).status).toBe("settled");
    expect(await resolveReward(() => Promise.reject(new Error("net")), wait)).toEqual({ status: "failed" });
    expect(await resolveReward(() => Promise.resolve(null), wait)).toEqual({ status: "none", reason: "mode" });
  });
});

describe("A3 zero-score notice", () => {
  it("detects a newly confirmed zero", () => {
    expect(zeroScored({ aces: 3 }, { aces: 3, yacht: 0 })).toBe("yacht");
    expect(zeroScored({ aces: 3 }, { aces: 3, choice: 20 })).toBeNull();
    expect(zeroScored({ yacht: 0 }, { yacht: 0 })).toBeNull();
  });
  it("uses neutral, factual wording", () => {
    const upperZero = zeroScoreNotice("aces", { aces: 0, deuces: 6, threes: 9 });
    expect(upperZero.title).toBe("에이스 (1) 0점 기록");
    expect(upperZero.detail).toBe("상단 보너스까지 48점");
    const hopeless = { aces: 0, deuces: 0, threes: 0, fours: 0 };
    expect(maxUpper(hopeless)).toBeLessThan(63);
    expect(zeroScoreNotice("fours", hopeless).detail).toBe("남은 칸 8개");
    expect(zeroScoreNotice("yacht", { yacht: 0 }).detail).toBe("남은 칸 11개");
    for (const n of [upperZero, zeroScoreNotice("yacht", { yacht: 0 })]) expect(`${n.title} ${n.detail}`).not.toMatch(/실패|아쉽|망|실수/);
  });
});

describe("A3 sound plan", () => {
  it("accent mode never repeats the win/lose sound game-feel already played", () => {
    const plan = resultSoundPlan("win", "grand-comeback");
    expect(plan.map((c) => c.sfx)).not.toContain("win");
    expect(plan.map((c) => c.sfx)).toContain("fxFanfare");
    expect(resultSoundPlan("loss", null)).toEqual([]);
    expect(resultSoundPlan("win", null, { includeBase: true })[0].sfx).toBe("win");
    expect(resultSoundPlan("rank", null, { includeBase: true, rank: 1, shared: true })[0].sfx).toBe("winShared");
  });
});

describe("A3 adapters use public observations only", () => {
  it("online events → steps and forfeits; offline card history → steps", () => {
    const events: OnlineEvent[] = [
      { seq: 1, at: 1000, type: "matchStarted", order: ["a", "b"] },
      { seq: 2, at: 1100, type: "categoryScored", playerId: "a", category: "choice", points: 20, dice: [4, 4, 4, 4, 4] },
      { seq: 3, at: 1200, type: "playerForfeited", playerId: "b", reason: "left" },
      { seq: 4, at: 1300, type: "matchFinished", standings: [], winners: ["a"] },
    ];
    const input = fromOnline({ players: [{ playerId: "a", name: "A", card: { choice: 20 }, total: 20 }, { playerId: "b", name: "B", card: {}, total: 0 }], winners: ["a"] }, events, "a");
    expect(input.steps).toEqual([{ seat: "a", category: "choice", points: 20 }]);
    expect(input.seats[1].forfeited).toBe("left");
    expect(input.endedAt! - input.startedAt!).toBe(300);
    expect(summarize(input).outcome.kind).toBe("forfeit-win");
    expect(stepsFromCards([[{}, {}], [{ aces: 3 }, {}], [{ aces: 3 }, { yacht: 0 }]], ["x", "y"])).toEqual([
      { seat: "x", category: "aces", points: 3 },
      { seat: "y", category: "yacht", points: 0 },
    ]);
  });
});

describe("A3 panel markup", () => {
  const render = (input: ResultInput, actions = {}) => renderToStaticMarkup(createElement(MatchResultPanel, { input, actions, sound: "off", motion: "none" }));
  it("shows scores, profiles, highlights, duration and the verified reward", () => {
    const html = render(scenario("grand"), { onRematch: () => {}, onReview: () => {}, onShare: () => {}, onHome: () => {}, addFriend: { name: "친구A", onClick: () => {} } });
    for (const text of ["대역전승", "주사위장인", "역전의 명수", "167", "135", "경기 시간 14분 32초", "요트", "라지 스트레이트", "3연승", "+13", "1승", "첫 요트", "재대결", "게임 리뷰", "친구 추가", "공유", "홈으로"]) expect(html).toContain(text);
  });
  it("buttons appear only when the caller provides them; pending reward shows no amount", () => {
    const html = render(scenario("comeback"));
    expect(html).not.toContain("재대결");
    expect(html).not.toContain("친구 추가");
    expect(html).toContain("보상을 확인하는 중");
    expect(html).not.toMatch(/\+\d+코인/);
  });
});

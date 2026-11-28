import { describe, expect, it } from "vitest";
import { forfeitLabel, summarize, type ResultInput, type ResultSeat } from "../src/match-result/model";
import { fromOnline } from "../src/match-result/adapters";
import { categories, type Card } from "../src/engine";

const full = (v: number): Card => Object.fromEntries(categories.map((c) => [c, v])) as Card;
const seat = (id: string, total: number, extra: Partial<ResultSeat> = {}): ResultSeat => ({ id, name: id.toUpperCase(), card: full(0), total, ...extra });

describe("UI-1 online result model", () => {
  it("2인: 대결형, 기권승·기권패·무승부 구분", () => {
    const base: ResultInput = { mode: "online", seats: [seat("a", 120, { you: true }), seat("b", 90)], winners: ["a"] };
    expect(summarize(base).outcome.kind).toBe("win");
    expect(summarize({ ...base, seats: [seat("a", 120, { you: true }), seat("b", 90, { forfeited: "timeout" })] }).outcome).toMatchObject({ kind: "forfeit-win", subtitle: "B 님이 시간 초과로 기권 처리됐어요" });
    expect(summarize({ ...base, seats: [seat("a", 120, { you: true, forfeited: "left" }), seat("b", 90)], winners: ["b"] }).outcome.kind).toBe("forfeit-loss");
    expect(summarize({ ...base, seats: [seat("a", 100, { you: true }), seat("b", 100)], winners: ["a", "b"] }).outcome.kind).toBe("draw");
  });

  it("다인전: 내 순위, 공동 순위, 기권자는 아래", () => {
    const seats = [seat("a", 150), seat("b", 150, { you: true }), seat("c", 200, { forfeited: "resign" }), seat("d", 90)];
    const s = summarize({ mode: "friend", seats, winners: ["a", "b"] });
    expect(s.outcome).toMatchObject({ kind: "rank", title: "공동 1위", subtitle: "4명 중", rank: 1, sharedRank: true });
    expect(s.standings.map((r) => r.seat.id)).toEqual(["a", "b", "d", "c"]);
    expect(s.standings.find((r) => r.seat.id === "c")!.rank).toBe(4);
  });

  it("관전자: 경기 전체 결과만, 승패 색·보상·개인 기록 없음", () => {
    const seats = [seat("a", 150), seat("b", 120), seat("c", 90)];
    const s = summarize({ mode: "friend", seats, winners: ["a"], spectator: true, personal: { bestBefore: 10, source: "device" }, streak: { current: 3, best: 3 } });
    expect(s.outcome).toMatchObject({ kind: "observer", title: "A 승리", subtitle: "3명 경기 결과", tone: "neutral" });
    expect(s.highlights.map((h) => h.id)).not.toContain("personal-best");
    expect(s.highlights.map((h) => h.id)).not.toContain("streak");
    expect(s.standings.some((r) => r.you)).toBe(false);
    const duel = summarize({ mode: "online", seats: [seat("a", 50), seat("b", 30, { forfeited: "left" })], winners: ["a"], spectator: true });
    expect(duel.outcome.subtitle).toBe("B 님이 경기를 떠났어요");
    const tie = summarize({ mode: "friend", seats, winners: ["a", "b"], spectator: true });
    expect(tie.outcome.title).toBe("공동 1위");
  });

  it("무효 경기는 승패 없이 사유만 (서버 계약이 생기면 연결)", () => {
    const s = summarize({ mode: "online", seats: [seat("a", 10, { you: true }), seat("b", 0)], winners: ["a"], voided: { reason: "서버 점검으로 중단됐어요" } });
    expect(s.outcome).toMatchObject({ kind: "void", title: "무효 경기", tone: "neutral" });
    expect(s.drama).toBeNull();
  });

  it("기권 사유 표시와, 이벤트가 없을 때 좌석 상태로 기권 표시", () => {
    expect([forfeitLabel("resign"), forfeitLabel("timeout"), forfeitLabel("left")]).toEqual(["기권", "시간 초과", "이탈"]);
    const input = fromOnline({ players: [{ playerId: "a", name: "A", card: {}, total: 0, status: "forfeited" }, { playerId: "b", name: "B", card: {}, total: 0, status: "active" }], winners: ["b"] }, [], null, { spectator: true });
    expect(input.seats[0].forfeited).toBe("resign");
    expect(input.seats.every((s) => !s.you)).toBe(true);
    expect(input.spectator).toBe(true);
  });

  it("20명 순위표도 모든 좌석을 순위와 함께 만든다", () => {
    const seats = Array.from({ length: 20 }, (_, i) => seat("p" + i, 200 - i * 5, { you: i === 7 }));
    const s = summarize({ mode: "friend", seats, winners: ["p0"] });
    expect(s.standings).toHaveLength(20);
    expect(s.outcome).toMatchObject({ kind: "rank", title: "8위", subtitle: "20명 중" });
  });
});

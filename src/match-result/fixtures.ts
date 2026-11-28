/**
 * 개발용 미리보기·테스트 예시 데이터 (실제 경기 기록 아님).
 * 각 예시는 채점 순서에서 카드를 만들어, 화면이 실제 경기와 같은 경로(buildTimeline)로 판정되게 한다.
 */
import type { Card, Category } from "../engine";
import type { MatchReceipt } from "../economy/live/receipt";
import type { ResultInput, ResultSeat, ScoreStep } from "./model";

type Seq = [Category, number][];

/** 좌석 순서대로 한 칸씩 번갈아 채점한 경기. */
export function playedGame(seats: { id: string; name: string; you?: boolean; seq: Seq; forfeited?: ResultSeat["forfeited"]; title?: string; kind?: ResultSeat["kind"] }[]) {
  const steps: ScoreStep[] = [];
  const longest = Math.max(...seats.map((s) => s.seq.length));
  for (let i = 0; i < longest; i++) for (const s of seats) if (s.seq[i]) steps.push({ seat: s.id, category: s.seq[i][0], points: s.seq[i][1] });
  const cards: Record<string, Card> = {};
  for (const s of seats) cards[s.id] = Object.fromEntries(s.seq);
  return {
    seats: seats.map(({ seq: _seq, ...rest }) => ({ ...rest, card: cards[rest.id] })) as ResultSeat[],
    steps,
  };
}

const T0 = Date.UTC(2026, 10, 27, 11, 0, 0);
const receipt = (coins: number, gems: number, quests: MatchReceipt["quests"], grants: MatchReceipt["grants"] = []): MatchReceipt => ({
  before: { coins: 1240, gems: 35 },
  after: { coins: 1240 + coins, gems: 35 + gems },
  quests,
  grants,
});

// 대역전승: 9라운드 끝 70점 뒤짐 → 요트·라지로 뒤집음.
const grand = playedGame([
  { id: "me", name: "주사위장인", you: true, title: "역전의 명수", kind: "member",
    seq: [["aces", 2], ["deuces", 4], ["choice", 18], ["threes", 6], ["four", 0], ["fours", 8], ["fives", 10], ["full", 0], ["small", 15], ["sixes", 24], ["yacht", 50], ["large", 30]] },
  { id: "op", name: "친구A", kind: "member",
    seq: [["choice", 22], ["full", 25], ["small", 15], ["four", 20], ["sixes", 18], ["fives", 15], ["fours", 8], ["threes", 6], ["deuces", 4], ["aces", 2], ["large", 0], ["yacht", 0]] },
]);
// 역전승: 7라운드 끝 25점 뒤짐 → 156:123
const comeback = playedGame([
  { id: "me", name: "주사위장인", you: true,
    seq: [["choice", 14], ["full", 22], ["sixes", 12], ["fives", 15], ["aces", 2], ["deuces", 4], ["threes", 6], ["fours", 12], ["small", 15], ["four", 24], ["large", 30], ["yacht", 0]] },
  { id: "op", name: "친구A",
    seq: [["choice", 24], ["full", 25], ["sixes", 24], ["fives", 15], ["aces", 2], ["deuces", 4], ["threes", 6], ["fours", 8], ["small", 15], ["four", 0], ["large", 0], ["yacht", 0]] },
]);
// 마지막 차례 역전: 상대가 먼저 끝내고 내 마지막 요트로 뒤집음.
const finalTurn = playedGame([
  { id: "op", name: "친구B",
    seq: [["choice", 22], ["full", 25], ["small", 15], ["sixes", 24], ["fives", 20], ["fours", 12], ["threes", 9], ["deuces", 6], ["aces", 3], ["four", 20], ["large", 0], ["yacht", 0]] },
  { id: "me", name: "주사위장인", you: true,
    seq: [["choice", 21], ["full", 25], ["sixes", 24], ["fives", 20], ["fours", 12], ["threes", 9], ["deuces", 6], ["aces", 3], ["small", 15], ["four", 18], ["large", 0], ["yacht", 50]] },
]);
// 접전 승리: 큰 열세 없이 6점 차.
const close = playedGame([
  { id: "me", name: "주사위장인", you: true,
    seq: [["choice", 22], ["full", 25], ["sixes", 24], ["fives", 20], ["fours", 12], ["threes", 9], ["deuces", 6], ["aces", 3], ["small", 15], ["four", 16], ["large", 30], ["yacht", 0]] },
  { id: "op", name: "친구A",
    seq: [["choice", 23], ["full", 25], ["sixes", 24], ["fives", 20], ["fours", 12], ["threes", 9], ["deuces", 6], ["aces", 2], ["small", 15], ["four", 10], ["large", 30], ["yacht", 0]] },
]);
const loss = playedGame([
  { id: "me", name: "주사위장인", you: true,
    seq: [["choice", 20], ["full", 0], ["sixes", 18], ["fives", 15], ["fours", 12], ["threes", 6], ["deuces", 4], ["aces", 2], ["small", 15], ["four", 0], ["large", 0], ["yacht", 0]] },
  { id: "op", name: "AI · 매우 어려움", kind: "ai",
    seq: [["choice", 23], ["full", 25], ["sixes", 24], ["fives", 20], ["fours", 12], ["threes", 9], ["deuces", 6], ["aces", 3], ["small", 15], ["four", 20], ["large", 30], ["yacht", 50]] },
]);
const draw = playedGame([
  { id: "me", name: "주사위장인", you: true, seq: [["choice", 22], ["full", 25], ["small", 15], ["large", 30]] },
  { id: "op", name: "친구A", seq: [["choice", 22], ["full", 25], ["small", 15], ["large", 30]] },
]);
const field = playedGame([
  { id: "a", name: "친구A", seq: [["choice", 25], ["full", 25], ["large", 30], ["yacht", 50]] },
  { id: "me", name: "주사위장인", you: true, seq: [["choice", 22], ["full", 25], ["large", 30], ["yacht", 0]] },
  { id: "b", name: "친구B", seq: [["choice", 22], ["full", 25], ["large", 30], ["yacht", 0]] },
  { id: "c", name: "친구C", seq: [["choice", 18], ["full", 0], ["large", 30], ["yacht", 0]] },
]);
const forfeit = playedGame([
  { id: "me", name: "주사위장인", you: true, seq: [["choice", 22], ["full", 25], ["small", 15]] },
  { id: "op", name: "친구A", forfeited: "left", seq: [["choice", 18], ["full", 0]] },
]);
const solo = playedGame([{ id: "me", name: "주사위장인", you: true,
  seq: [["aces", 3], ["deuces", 6], ["threes", 9], ["fours", 12], ["fives", 20], ["sixes", 24], ["choice", 24], ["four", 24], ["full", 28], ["small", 15], ["large", 30], ["yacht", 50]] }]);

export type Scenario = { id: string; label: string; input: ResultInput; friend?: boolean };

export const SCENARIOS: Scenario[] = [
  { id: "grand", label: "대역전승 · 보상 지급", friend: true, input: { mode: "online", ...grand, winners: ["me"], startedAt: T0, endedAt: T0 + 14 * 60_000 + 32_000,
    personal: { bestBefore: 160, source: "account" }, streak: { current: 3, best: 5 },
    rewards: { status: "settled", receipt: receipt(13, 0, [{ id: "d.win1", previous: 0, progress: 1, done: true }, { id: "d.play3", previous: 1, progress: 2, done: false }], [{ kind: "achievement", label: "첫 요트", coins: 70, gems: 10 }]) } } },
  { id: "comeback", label: "역전승", input: { mode: "online", ...comeback, winners: ["me"], startedAt: T0, endedAt: T0 + 11 * 60_000, rewards: { status: "pending" } } },
  { id: "final-turn", label: "마지막 차례 역전", input: { mode: "friend", ...finalTurn, winners: ["me"], startedAt: T0, endedAt: T0 + 18 * 60_000, rewards: { status: "settled", receipt: receipt(10, 0, []) } } },
  { id: "close", label: "접전 승리", input: { mode: "online", ...close, winners: ["me"], startedAt: T0, endedAt: T0 + 9 * 60_000, rewards: { status: "delayed" } } },
  { id: "loss", label: "패배 (AI)", input: { mode: "ai", ...loss, winners: ["op"], startedAt: T0, endedAt: T0 + 7 * 60_000, personal: { bestBefore: 210, source: "device" }, rewards: { status: "none", reason: "mode" } } },
  { id: "draw", label: "무승부", input: { mode: "friend", ...draw, winners: ["me", "op"], rewards: { status: "failed" } } },
  { id: "forfeit", label: "상대 기권", input: { mode: "online", ...forfeit, winners: ["me"], startedAt: T0, endedAt: T0 + 4 * 60_000, rewards: { status: "settled", receipt: receipt(0, 0, []) } } },
  { id: "forfeit-loss", label: "내가 기권", input: { mode: "online", ...playedGame([
    { id: "me", name: "주사위장인", you: true, forfeited: "timeout", seq: [["choice", 22], ["full", 25]] },
    { id: "op", name: "친구A", seq: [["choice", 18], ["full", 0], ["small", 15]] },
  ]), winners: ["op"], rewards: { status: "none", reason: "guest" } } },
  { id: "field", label: "다인전 · 공동 2위", input: { mode: "friend", ...field, winners: ["a"], startedAt: T0, endedAt: T0 + 22 * 60_000 } },
  { id: "solo", label: "1인 플레이 · 최고 기록", input: { mode: "solo", ...solo, winners: ["me"], steps: null, startedAt: T0, endedAt: T0 + 6 * 60_000, personal: { bestBefore: 241, source: "device" } } },
  { id: "solo-first", label: "1인 플레이 · 첫 기록", input: { mode: "solo", ...solo, winners: ["me"], steps: null, personal: { bestBefore: null, source: "device" } } },
];

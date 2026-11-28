/**
 * 실제 경기 데이터 → A3 ResultInput 변환 (통합 단계에서 게임 화면이 사용).
 * RNG·seed 등 비공개 엔진 상태는 읽지 않는다: 카드, 채점 행동, 서버 이벤트(공개 관측)만 쓴다.
 */
import { categories, type Card } from "../engine";
import type { OnlineEvent } from "../online/protocol";
import type { MultiReplay } from "../multi-replay";
import { createGameFor, transitionMulti } from "../multi-engine";
import type { ResultInput, ResultSeat, ScoreStep } from "./model";

type OnlinePlayerLike = { playerId: string; name: string; card: Card; total: number; status?: string };

/** 서버 이벤트 로그(전체)의 categoryScored 순서가 그대로 채점 순서다. 로그가 일부만 있으면 buildTimeline이 invalid로 판정한다. */
export function stepsFromOnline(events: readonly OnlineEvent[]): ScoreStep[] {
  return events.flatMap((e) => (e.type === "categoryScored" ? [{ seat: e.playerId, category: e.category, points: e.points, ...(e.auto ? { auto: true } : {}) }] : []));
}

export function fromOnline(
  view: { players: readonly OnlinePlayerLike[]; winners: readonly string[] },
  events: readonly OnlineEvent[],
  me: string | null,
  extra: Partial<Pick<ResultInput, "mode" | "personal" | "streak" | "rewards" | "spectator">> & { titles?: Record<string, string>; members?: Record<string, string> } = {},
): ResultInput {
  const forfeits = new Map<string, Extract<OnlineEvent, { type: "playerForfeited" }>["reason"]>();
  for (const e of events) if (e.type === "playerForfeited") forfeits.set(e.playerId, e.reason);
  const seats: ResultSeat[] = view.players.map((p) => ({
    id: p.playerId,
    name: p.name,
    you: p.playerId === me,
    kind: extra.members?.[p.playerId] ? "member" : "guest",
    title: extra.titles?.[p.playerId],
    card: { ...p.card },
    total: p.total,
    // A spectator or a reloaded screen may not hold the forfeit event: the seat status still says so (reason unknown → "기권").
    forfeited: forfeits.get(p.playerId) ?? (p.status === "forfeited" ? "resign" : null),
  }));
  return {
    mode: extra.mode ?? "online",
    seats,
    winners: [...view.winners],
    steps: stepsFromOnline(events),
    startedAt: events.find((e) => e.type === "matchStarted")?.at ?? null,
    endedAt: events.find((e) => e.type === "matchFinished")?.at ?? null,
    personal: extra.personal,
    streak: extra.streak,
    rewards: extra.rewards,
    spectator: extra.spectator,
  };
}

/** 오프라인 기보: 연속한 프레임의 카드 변화에서 채점 순서를 만든다(한 프레임에 한 칸). */
export function stepsFromCards(history: readonly (readonly Card[])[], seatIds: readonly string[]): ScoreStep[] {
  const steps: ScoreStep[] = [];
  for (let i = 1; i < history.length; i++) {
    history[i].forEach((card, seat) => {
      const before = history[i - 1][seat] ?? {};
      for (const c of categories) if (before[c] === undefined && card[c] !== undefined) steps.push({ seat: seatIds[seat], category: c, points: card[c]! });
    });
  }
  return steps;
}

export function fromOfflineFrames(frames: readonly { state: { cards: readonly Card[] } }[], seats: { id: string; name: string; you?: boolean; kind?: ResultSeat["kind"] }[], winners: string[], extra: Partial<ResultInput> = {}): ResultInput {
  const last = frames.at(-1)?.state.cards ?? [];
  return {
    mode: "ai",
    ...extra,
    seats: seats.map((s, i) => ({ ...s, card: { ...(last[i] ?? {}) } })),
    winners,
    steps: stepsFromCards(frames.map((f) => f.state.cards), seats.map((s) => s.id)),
  };
}

/**
 * N인·1인 기보(MultiReplay): 기록된 행동을 같은 엔진으로 다시 적용해 채점 직후 카드만 모은다.
 * 결과 표시용으로 이미 끝난 경기의 공개된 기록만 재현하며, 미래 주사위를 예측하는 데 쓰지 않는다.
 */
export function cardsHistoryFromMulti(replay: MultiReplay): Card[][] {
  let state = createGameFor(replay.metadata.players.length, replay.seed, replay.version === 1);
  const history: Card[][] = [state.cards.map((c) => ({ ...c }))];
  for (const action of replay.actions) {
    state = transitionMulti(state, action);
    if (action.type === "score") history.push(state.cards.map((c) => ({ ...c })));
  }
  return history;
}

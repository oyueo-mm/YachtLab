import { total, type Action, type Card, type Game } from "../engine";
import { createMultiGame, transitionMulti, type MultiGame } from "../multi-engine";
import type { MultiReplay } from "../multi-replay";
import type { Replay } from "../replay";
import type { OnlineEvent } from "../online/protocol";
import type { PlayerView } from "../online/server-engine";
import type { Position, ReviewMatch, Situation } from "./model";

export type ReviewSource = ReviewMatch | string;
export const missingOnlineReview = "이 경기에는 양쪽의 전체 굴림과 점수 기록이 저장되지 않았어요.";

function publicPosition(state: Pick<MultiGame, "player" | "cards" | "dice" | "rolls" | "round">): Position {
  return {
    player: state.player === 0 ? 0 : 1,
    cards: [{ ...state.cards[0] }, { ...state.cards[1] }],
    dice: state.dice.map((die) => ({ ...die })),
    rolls: state.rolls,
    round: state.round,
  };
}

function decision(before: Game | MultiGame, action: Action, after: Game | MultiGame): Situation | null {
  if (!before.rolls) return null;
  if (action.type === "score") return { before: publicPosition(before), action: { type: "score", category: action.category } };
  if (action.type !== "roll") return null;
  return { before: publicPosition(before), action: { type: "reroll", ids: before.dice.filter((die) => die.held).map((die) => die.id) }, afterRoll: publicPosition(after) };
}

export function fromReplay(replay: Replay): ReviewSource {
  if (!replay.finalState.done) return "경기를 완료하면 복기할 수 있어요.";
  const steps = replay.frames.slice(1).flatMap((frame, index) => {
    const item = frame.action && decision(replay.frames[index].state, frame.action, frame.state);
    return item ? [item] : [];
  });
  return { id: replay.metadata.id, players: [replay.metadata.players[0].name, replay.metadata.players[1].name],
    scores: [total(replay.finalState.cards[0]), total(replay.finalState.cards[1])],
    winners: replay.finalState.winner === "draw" || replay.finalState.winner === null ? [0, 1] : [replay.finalState.winner], device: true, steps };
}

export function fromMultiReplay(replay: MultiReplay): ReviewSource {
  if (!replay.finalState.done) return "경기를 완료하면 복기할 수 있어요.";
  if (replay.metadata.players.length !== 2) return "AI 복기는 1:1 경기에서 지원해요. 이 경기는 기존 기보로 볼 수 있어요.";
  let state = createMultiGame(2, replay.seed, replay.version === 1);
  const steps: Situation[] = [];
  for (const action of replay.actions) {
    const next = transitionMulti(state, action);
    const item = decision(state, action, next);
    if (item) steps.push(item);
    state = next;
  }
  return { id: replay.metadata.id, players: [replay.metadata.players[0].name, replay.metadata.players[1].name],
    scores: [total(state.cards[0]), total(state.cards[1])], winners: state.winners.map((id) => id === 0 ? 0 : 1), device: true, steps };
}

export function fromOnline(view: PlayerView, history: readonly OnlineEvent[]): ReviewSource {
  if (view.status !== "finished" || !view.you) return "완료한 본인 경기에서 복기할 수 있어요.";
  if (view.players.length !== 2) return "1:1 경기를 분석할 수 있어요.";
  const ordered = [...history].sort((a, b) => a.seq - b.seq);
  if (ordered[0]?.type !== "matchCreated" || ordered.at(-1)?.type !== "matchFinished" ||
      ordered.some((event, index) => event.seq !== index + ordered[0].seq)) return missingOnlineReview;
  const playerIds = view.players.map((player) => player.playerId);
  const cards: [Card, Card] = [{}, {}];
  const positions: [Position | null, Position | null] = [null, null];
  const simultaneously = view.mode === "simultaneous";
  const visibleCards = (): [Card, Card] => [{ ...cards[0] }, { ...cards[1] }];
  let round = 1;
  const steps: Situation[] = [];
  for (const event of ordered) {
    if (event.type === "turnStarted" || event.type === "roundStarted") {
      positions[0] = positions[1] = null;
      round = event.round;
    }
    if (event.type === "diceRolled") {
      const seat = playerIds.indexOf(event.playerId);
      if (seat < 0) return missingOnlineReview;
      const next: Position = {
        cards: visibleCards(),
        ...(simultaneously ? { simultaneous: true } : {}),
        dice: event.dice.map((value, id) => ({ value, id, held: event.kept.includes(id) })),
        rolls: event.roll, round, player: seat === 0 ? 0 : 1,
      };
      const position = positions[seat];
      if (position) steps.push({ before: { ...position, cards: visibleCards(), dice: position.dice.map((die) => ({ ...die, held: event.kept.includes(die.id) })) },
        action: { type: "reroll", ids: [...event.kept] }, afterRoll: next });
      positions[seat] = next;
    }
    if (event.type === "categoryScored") {
      const seat = playerIds.indexOf(event.playerId);
      if (seat < 0) return missingOnlineReview;
      const position = positions[seat];
      if (position && !event.auto) steps.push({ before: { ...position, cards: visibleCards() }, action: { type: "score", category: event.category } });
      cards[seat][event.category] = event.points;
      positions[seat] = null;
    }
  }
  if (!steps.length) return "분석할 확정 행동이 없어요.";
  return { id: view.matchId, players: [view.players[0].name, view.players[1].name], scores: [view.players[0].total, view.players[1].total], winners: view.winners.map((winner) => winner === playerIds[0] ? 0 : 1), steps };
}

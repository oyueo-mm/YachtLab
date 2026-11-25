import { total, type Action, type Game } from "../engine";
import { createMultiGame, transitionMulti, type MultiGame } from "../multi-engine";
import type { MultiReplay } from "../multi-replay";
import type { Replay } from "../replay";
import type { Position, ReviewMatch, Situation } from "./model";

export type ReviewSource = ReviewMatch | string;
export { fromOnline, missingOnlineReview } from "./online-source";

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
  if (!replay.finalState.done) return "경기를 완료하면 리뷰할 수 있어요.";
  const steps = replay.frames.slice(1).flatMap((frame, index) => {
    const item = frame.action && decision(replay.frames[index].state, frame.action, frame.state);
    return item ? [item] : [];
  });
  return { id: replay.metadata.id, players: [replay.metadata.players[0].name, replay.metadata.players[1].name],
    scores: [total(replay.finalState.cards[0]), total(replay.finalState.cards[1])],
    winners: replay.finalState.winner === "draw" || replay.finalState.winner === null ? [0, 1] : [replay.finalState.winner], device: true, steps };
}

export function fromMultiReplay(replay: MultiReplay): ReviewSource {
  if (!replay.finalState.done) return "경기를 완료하면 리뷰할 수 있어요.";
  if (replay.metadata.players.length !== 2) return "게임 리뷰는 1:1 경기에서 지원해요. 이 경기는 기존 기보로 볼 수 있어요.";
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

import { total, type Action, type Game } from "../engine";
import { createMultiGame, createSoloGame, transitionMulti, type MultiGame } from "../multi-engine";
import type { MultiReplay } from "../multi-replay";
import type { Replay } from "../replay";
import type { Position, ReviewMatch, Situation } from "./model";
import { fromOnline as onlineTrace } from "./online-source";

export type ReviewSource = ReviewMatch | string;
export { missingOnlineReview } from "./online-source";

// Keep new roll observations in the browser trace without changing the server's archive.
export function fromOnline(view: Parameters<typeof onlineTrace>[0], history: Parameters<typeof onlineTrace>[1], looks?: Parameters<typeof onlineTrace>[2]) {
  return onlineTrace(view, history, looks, true);
}

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

function collectSteps(frames: Iterable<{ before: Game | MultiGame; action: Action; after: Game | MultiGame }>, solo = false) {
  let firstRoll: Position | undefined;
  const steps: Situation[] = [];
  for (const { before, action, after } of frames) {
    if (action.type === "roll" && before.rolls === 0) firstRoll = publicPosition(after);
    const item = decision(before, action, after);
    if (!item) continue;
    if (solo) {
      item.before.simultaneous = true;
      if (item.afterRoll) item.afterRoll.simultaneous = true;
      if (firstRoll) firstRoll.simultaneous = true;
    }
    if (firstRoll) item.firstRoll = firstRoll;
    steps.push(item);
    firstRoll = undefined;
  }
  return steps;
}

function* multiFrames(initial: MultiGame, actions: Action[]) {
  let before = initial;
  for (const action of actions) {
    const after = transitionMulti(before, action);
    yield { before, action, after };
    before = after;
  }
}

export function fromReplay(replay: Replay): ReviewSource {
  if (!replay.finalState.done) return "경기를 완료하면 리뷰할 수 있어요.";
  const steps = collectSteps(replay.frames.slice(1).flatMap(({ action, state }, index) =>
    action ? [{ before: replay.frames[index].state, action, after: state }] : []));
  return { id: replay.metadata.id, players: [replay.metadata.players[0].name, replay.metadata.players[1].name],
    scores: [total(replay.finalState.cards[0]), total(replay.finalState.cards[1])],
    winners: replay.finalState.winner === "draw" || replay.finalState.winner === null ? [0, 1] : [replay.finalState.winner], device: true,
    ...(replay.metadata.players.filter((p) => p.type === "human").length === 1 ? { me: replay.metadata.players[0].type === "human" ? 0 as const : 1 as const } : {}), steps };
}

export function fromMultiReplay(replay: MultiReplay): ReviewSource {
  if (!replay.finalState.done) return "경기를 완료하면 리뷰할 수 있어요.";
  if (replay.metadata.players.length !== 2) return "게임 리뷰는 1:1 경기에서 지원해요. 이 경기는 기존 기보로 볼 수 있어요.";
  const state = replay.finalState;
  const steps = collectSteps(multiFrames(createMultiGame(2, replay.seed, replay.version === 1), replay.actions));
  return { id: replay.metadata.id, players: [replay.metadata.players[0].name, replay.metadata.players[1].name],
    scores: [total(state.cards[0]), total(state.cards[1])], winners: state.winners.map((id) => id === 0 ? 0 : 1), device: true, steps };
}

/**
 * 1인 플레이 review: every decision is judged by DP Expert expected score only. Positions are marked
 * `simultaneous` so the two-player win-credit endgame (which needs an opponent) is never applied.
 */
export function fromSoloReplay(replay: MultiReplay): ReviewSource {
  if (!replay.finalState.done) return "경기를 완료하면 리뷰할 수 있어요.";
  if (replay.metadata.players.length !== 1) return fromMultiReplay(replay);
  const state = replay.finalState;
  const steps = collectSteps(multiFrames(createSoloGame(replay.seed), replay.actions), true);
  const name = replay.metadata.players[0].name;
  return { id: replay.metadata.id, players: [name, ""], scores: [total(state.cards[0]), 0], winners: [0], me: 0, device: true, solo: true, steps };
}

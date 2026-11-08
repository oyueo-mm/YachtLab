import { available, random, score, total, type Action, type Card, type Die } from "./engine";

/** Separate state machine: existing two-player AI and v1 replay remain unchanged. */
export type MultiGame = {
  dice: Die[];
  order: number[];
  cards: Card[];
  player: number;
  round: number;
  rolls: number;
  done: boolean;
  winners: number[];
  seed: number;
  rng: number[];
  actions: number;
};

export type Standing = { player: number; points: number; rank: number; finished: number };

export function createMultiGame(count: number, seed: number): MultiGame {
  if (!Number.isSafeInteger(count) || count < 2) throw Error("참가 인원은 2명 이상이어야 합니다.");
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw Error("잘못된 난수 시드입니다.");
  return {
    dice: Array.from({ length: 5 }, (_, id) => ({ id, value: 1, held: false })),
    order: [0, 1, 2, 3, 4],
    cards: Array.from({ length: count }, () => ({})),
    player: 0,
    round: 1,
    rolls: 0,
    done: false,
    winners: [],
    seed: seed >>> 0,
    // Each participant has an independent stream, initialized consistently with legacy 2-player games.
    rng: Array.from({ length: count }, () => seed >>> 0),
    actions: 0,
  };
}

export function multiStandings(state: MultiGame): Standing[] {
  const standings = state.cards.map((card, player) => ({
    player, points: total(card), finished: 12 - available(card).length, rank: 0,
  })).sort((a, b) => b.points - a.points || a.player - b.player);
  standings.forEach((item, i) => { item.rank = i > 0 && item.points === standings[i - 1].points ? standings[i - 1].rank : i + 1; });
  return standings;
}

export function transitionMulti(state: MultiGame, action: Action): MultiGame {
  if (state.done) throw Error("이미 종료된 경기입니다.");
  if (action.type === "order") {
    if (action.ids.length !== 5 || new Set(action.ids).size !== 5 || action.ids.some((id) => !Number.isInteger(id) || id < 0 || id > 4)) throw Error("잘못된 주사위 순서입니다.");
    return { ...state, order: [...action.ids] };
  }
  const next: MultiGame = {
    ...state,
    dice: state.dice.map((die) => ({ ...die })),
    cards: [...state.cards],
    rng: [...state.rng],
    actions: state.actions + 1,
  };
  if (action.type === "roll") {
    if (next.rolls >= 3) throw Error("더 이상 굴릴 수 없습니다.");
    for (const die of next.dice) {
      if (!die.held || next.rolls === 0) {
        const [r, seed] = random(next.rng[next.player]);
        next.rng[next.player] = seed;
        die.value = 1 + Math.floor(r * 6);
      }
    }
    next.rolls++;
    return next;
  }
  if (action.type === "hold") {
    if (!next.rolls) throw Error("먼저 주사위를 굴려주세요.");
    if (new Set(action.ids).size !== action.ids.length || action.ids.some((id) => !Number.isInteger(id) || id < 0 || id > 4)) throw Error("알 수 없는 주사위입니다.");
    next.dice.forEach((die) => { die.held = action.ids.includes(die.id); });
    return next;
  }
  if (!next.rolls || next.cards[next.player][action.category] !== undefined) throw Error("선택할 수 없는 점수 칸입니다.");
  next.cards[next.player] = { ...next.cards[next.player] };
  next.cards[next.player][action.category] = score(next.dice.map((die) => die.value), action.category);
  const recorded = next.cards.reduce((sum, card) => sum + Object.keys(card).length, 0);
  if (recorded === next.cards.length * 12) {
    next.done = true;
    next.round = 12;
    const points = next.cards.map(total), top = Math.max(...points);
    next.winners = points.flatMap((points, i) => points === top ? [i] : []);
  } else {
    next.player = (next.player + 1) % next.cards.length;
    next.round = Math.floor(recorded / next.cards.length) + 1;
    next.rolls = 0;
    next.dice.forEach((die) => { die.held = false; });
  }
  return next;
}

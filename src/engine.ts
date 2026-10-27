export const categories = [
  "aces",
  "deuces",
  "threes",
  "fours",
  "fives",
  "sixes",
  "choice",
  "four",
  "full",
  "small",
  "large",
  "yacht",
] as const;
export type Category = (typeof categories)[number];
export const names: Record<Category, string> = {
  aces: "에이스 (1)",
  deuces: "듀스 (2)",
  threes: "트리플 (3)",
  fours: "쿼드 (4)",
  fives: "펜타 (5)",
  sixes: "헥사 (6)",
  choice: "초이스",
  four: "포커",
  full: "풀 하우스",
  small: "스몰 스트레이트",
  large: "라지 스트레이트",
  yacht: "요트",
};
export type Card = Partial<Record<Category, number>>;
export type Die = { id: number; value: number; held: boolean };
export type Game = {
  dice: Die[];
  order: number[];
  cards: [Card, Card];
  player: 0 | 1;
  round: number;
  rolls: number;
  done: boolean;
  winner: 0 | 1 | "draw" | null;
  seed: number;
  rng: [number, number];
  actions: number;
};
export type Action =
  | { type: "roll" }
  | { type: "hold"; ids: number[] }
  | { type: "score"; category: Category }
  | { type: "order"; ids: number[] };
export function score(values: number[], category: Category): number {
  if (
    values.length !== 5 ||
    values.some((v) => !Number.isInteger(v) || v < 1 || v > 6)
  )
    throw Error("주사위 눈은 1~6이어야 합니다.");
  const counts = Array(7).fill(0);
  values.forEach((v) => counts[v]++);
  const sum = values.reduce((a, b) => a + b, 0),
    index = categories.indexOf(category);
  if (index < 0) throw Error("알 수 없는 카테고리입니다.");
  if (index < 6) return counts[index + 1] * (index + 1);
  switch (category) {
    case "choice":
      return sum;
    case "four":
      return Math.max(...counts) >= 4 ? sum : 0;
    case "full":
      return counts.includes(3) && counts.includes(2) ? sum : 0;
    case "small":
      return [1, 2, 3].some((start) =>
        [0, 1, 2, 3].every((n) => counts[start + n] > 0),
      )
        ? 15
        : 0;
    case "large":
      return [1, 2].some((start) =>
        [0, 1, 2, 3, 4].every((n) => counts[start + n] > 0),
      )
        ? 30
        : 0;
    case "yacht":
      return counts.includes(5) ? 50 : 0;
    default:
      return 0;
  }
}
export const upper = (card: Card) =>
  categories.slice(0, 6).reduce((s, c) => s + (card[c] ?? 0), 0);
export const bonus = (card: Card) => (upper(card) >= 63 ? 35 : 0);
export const total = (card: Card) =>
  Object.values(card).reduce((s, v) => s + (v ?? 0), 0) + bonus(card);
export const available = (card: Card) =>
  categories.filter((c) => card[c] === undefined);
export function random(seed: number): [number, number] {
  const next = (Math.imul(1664525, seed >>> 0) + 1013904223) >>> 0;
  return [next / 4294967296, next];
}
export function createGame(seed = Date.now() >>> 0): Game {
  return {
    dice: Array.from({ length: 5 }, (_, id) => ({ id, value: 1, held: false })),
    order: [0, 1, 2, 3, 4],
    cards: [{}, {}],
    player: 0,
    round: 1,
    rolls: 0,
    done: false,
    winner: null,
    seed: seed >>> 0,
    rng: [seed >>> 0, seed >>> 0],
    actions: 0,
  };
}
export function transition(state: Game, action: Action): Game {
  if (action.type === "order") {
    if (
      action.ids.length !== 5 ||
      new Set(action.ids).size !== 5 ||
      action.ids.some((id) => !state.dice.some((d) => d.id === id))
    )
      throw Error("잘못된 주사위 순서입니다.");
    return { ...state, order: [...action.ids] };
  }
  if (state.done) throw Error("이미 종료된 경기입니다.");
  const s: Game = {
    ...state,
    dice: state.dice.map((d) => ({ ...d })),
    cards: [{ ...state.cards[0] }, { ...state.cards[1] }],
    rng: [...state.rng],
    actions: state.actions + 1,
  };
  if (action.type === "roll") {
    if (s.rolls >= 3) throw Error("더 이상 굴릴 수 없습니다.");
    for (const die of s.dice)
      if (!die.held || s.rolls === 0) {
        const [r, next] = random(s.rng[s.player]);
        s.rng[s.player] = next;
        die.value = 1 + Math.floor(r * 6);
      }
    s.rolls++;
    return s;
  }
  if (action.type === "hold") {
    if (!s.rolls) throw Error("먼저 주사위를 굴려주세요.");
    if (action.ids.some((id) => !s.dice.some((d) => d.id === id)))
      throw Error("알 수 없는 주사위입니다.");
    s.dice.forEach((d) => (d.held = action.ids.includes(d.id)));
    return s;
  }
  if (!s.rolls || s.cards[s.player][action.category] !== undefined)
    throw Error("선택할 수 없는 점수 칸입니다.");
  s.cards[s.player][action.category] = score(
    s.dice.map((d) => d.value),
    action.category,
  );
  if (s.player === 1 && available(s.cards[1]).length === 0) {
    s.done = true;
    const a = total(s.cards[0]),
      b = total(s.cards[1]);
    s.winner = a === b ? "draw" : a > b ? 0 : 1;
  } else {
    s.player = s.player === 0 ? 1 : 0;
    s.round = 13 - available(s.cards[s.player]).length;
    s.rolls = 0;
    s.dice.forEach((d) => (d.held = false));
  }
  return s;
}

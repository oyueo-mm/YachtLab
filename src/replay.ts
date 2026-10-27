import { algorithms, type Algorithm, type Decision } from "./ai";
import {
  createGame,
  transition,
  categories,
  names,
  total,
  type Action,
  type Game,
} from "./engine";
import type { Frame, Match } from "./match";
export const replayLimit = 8 * 1024 * 1024;
export type Player = {
  name: string;
  type: "human" | "ai";
  algorithm?: Algorithm;
};
export type Replay = {
  format: "YachtLabReplay";
  version: 1;
  metadata: {
    id: string;
    name: string;
    createdAt: string;
    ruleVersion: "YachtLab-12-v1";
    players: [Player, Player];
    source?: { replayId: string; frameIndex: number };
  };
  initialState: Game;
  frames: Frame[];
  finalState: Game;
};
export const clone = <T>(value: T): T => structuredClone(value);
export function actionText(action: Action | null, state: Game, actor: 0 | 1) {
  if (!action) return "경기 준비";
  if (action.type === "roll") return `${state.rolls}번째 굴림`;
  if (action.type === "hold") return `주사위 ${action.ids.length}개 고정`;
  if (action.type === "order") return "주사위 정렬";
  return `${names[action.category]} ${state.cards[actor][action.category]}점 기록`;
}
export function newReplay(
  state: Game,
  players: [Player, Player],
  name = "요트 대국",
): Replay {
  return {
    format: "YachtLabReplay",
    version: 1,
    metadata: {
      id: crypto.randomUUID(),
      name,
      createdAt: new Date().toISOString(),
      ruleVersion: "YachtLab-12-v1",
      players: clone(players),
    },
    initialState: clone(state),
    frames: [
      {
        state: clone(state),
        action: null,
        actor: state.player,
        label: "경기 준비",
        actorName: players[state.player].name,
      },
    ],
    finalState: clone(state),
  };
}
export function appendFrame(
  replay: Replay,
  action: Action,
  decision?: Decision,
): Replay {
  if (replay.frames.length >= 4096)
    throw Error("기보 행동 수 한도에 도달했습니다. 현재 기보를 저장해주세요.");
  const actor = replay.finalState.player,
    state = transition(replay.finalState, action),
    frame: Frame = {
      state,
      action: clone(action),
      actor,
      label: actionText(action, state, actor),
      actorName: replay.metadata.players[actor].name,
      ...(decision ? { decision: clone(decision) } : {}),
    };
  return { ...replay, frames: [...replay.frames, frame], finalState: state };
}
export function replayFromMatch(match: Match): Replay {
  const players = match.algorithms.map((algorithm) => ({
    name: algorithm,
    type: "ai" as const,
    algorithm,
  })) as [Player, Player];
  const r = newReplay(
    match.frames[0].state,
    players,
    `${players[0].name} vs ${players[1].name}`,
  );
  return {
    ...r,
    frames: clone(match.frames).map((f) => ({
      ...f,
      label: actionText(f.action, f.state, f.actor),
      actorName: f.actorName ?? players[f.actor].name,
    })),
    finalState: clone(match.frames.at(-1)!.state),
  };
}
export function branchReplay(
  source: Replay,
  index: number,
  match: Match,
): Replay {
  const trusted = validateReplay(source);
  if (!Number.isInteger(index) || index < 0 || index >= trusted.frames.length)
    throw Error("잘못된 분기 위치입니다.");
  if (!same(trusted.frames[index].state, match.frames[0].state))
    throw Error("분기 시작 상태가 원본과 다릅니다.");
  const branch = replayFromMatch(match);
  return validateReplay({
    ...branch,
    initialState: trusted.initialState,
    metadata: {
      ...branch.metadata,
      source: { replayId: trusted.metadata.id, frameIndex: index },
      name: `${trusted.metadata.name} · ${index}수 분기`,
    },
    frames: [...trusted.frames.slice(0, index + 1), ...branch.frames.slice(1)],
  });
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map(
          (k) =>
            JSON.stringify(k) +
            ":" +
            canonical((value as Record<string, unknown>)[k]),
        )
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
function object(x: unknown): Record<string, any> {
  if (!x || typeof x !== "object" || Array.isArray(x))
    throw Error("기보 객체 구조가 올바르지 않습니다.");
  return x as Record<string, any>;
}
function text(x: unknown, max = 120) {
  if (typeof x !== "string" || !x.length || x.length > max)
    throw Error("기보 문자열이 올바르지 않습니다.");
  return x;
}
export function validateAction(x: unknown): Action {
  const a = object(x);
  if (a.type === "roll" && Object.keys(a).length === 1) return { type: "roll" };
  if (
    (a.type === "hold" || a.type === "order") &&
    Object.keys(a).length === 2 &&
    Array.isArray(a.ids) &&
    a.ids.length <= 5 &&
    new Set(a.ids).size === a.ids.length &&
    a.ids.every(
      (id: unknown) =>
        Number.isInteger(id) && Number(id) >= 0 && Number(id) < 5,
    )
  )
    return { type: a.type, ids: [...a.ids] };
  if (
    a.type === "score" &&
    Object.keys(a).length === 2 &&
    categories.includes(a.category)
  )
    return { type: "score", category: a.category };
  throw Error("불법 행동이 포함된 기보입니다.");
}
export function validateGameShape(x: unknown): asserts x is Game {
  const s = object(x),
    uint = (n: unknown) =>
      Number.isInteger(n) && Number(n) >= 0 && Number(n) <= 4294967295;
  if (
    !uint(s.seed) ||
    !Array.isArray(s.rng) ||
    s.rng.length !== 2 ||
    !s.rng.every(uint) ||
    ![0, 1].includes(s.player) ||
    !Number.isInteger(s.rolls) ||
    s.rolls < 0 ||
    s.rolls > 3 ||
    !Number.isInteger(s.actions) ||
    s.actions < 0 ||
    s.actions > 1000000
  )
    throw Error("게임의 난수·차례·굴림 상태가 올바르지 않습니다.");
  if (
    !Array.isArray(s.dice) ||
    s.dice.length !== 5 ||
    s.dice.some(
      (d: any, i: number) =>
        !d ||
        d.id !== i ||
        !Number.isInteger(d.value) ||
        d.value < 1 ||
        d.value > 6 ||
        typeof d.held !== "boolean",
    ) ||
    !Array.isArray(s.order) ||
    s.order.length !== 5 ||
    new Set(s.order).size !== 5 ||
    s.order.some(
      (id: unknown) =>
        !Number.isInteger(id) || Number(id) < 0 || Number(id) > 4,
    )
  )
    throw Error("주사위 상태가 올바르지 않습니다.");
  if (!Array.isArray(s.cards) || s.cards.length !== 2)
    throw Error("점수판 구조가 올바르지 않습니다.");
  const counts = s.cards.map((card: unknown) => {
    const c = object(card);
    for (const [key, v] of Object.entries(c))
      if (
        !categories.includes(key as any) ||
        !Number.isInteger(v) ||
        Number(v) < 0 ||
        Number(v) > 50
      )
        throw Error("점수판 값이 올바르지 않습니다.");
    return Object.keys(c).length;
  });
  const done = counts[0] === 12 && counts[1] === 12;
  if (
    s.done !== done ||
    (!done &&
      (s.player === 0
        ? counts[0] !== counts[1]
        : counts[0] !== counts[1] + 1)) ||
    s.round !== (done ? 12 : 1 + counts[1]) ||
    (!s.rolls && s.dice.some((d: any) => d.held))
  )
    throw Error("라운드와 점수판 상태가 일치하지 않습니다.");
  const winner = done
    ? total(s.cards[0]) === total(s.cards[1])
      ? "draw"
      : total(s.cards[0]) > total(s.cards[1])
        ? 0
        : 1
    : null;
  if (s.winner !== winner) throw Error("승패 정보가 올바르지 않습니다.");
}
function safeDecision(
  x: unknown,
  action: Action,
  state: Game,
): Decision | undefined {
  if (x === undefined) return;
  const d = object(x);
  if (
    !Number.isFinite(d.value) ||
    !Array.isArray(d.candidates) ||
    d.candidates.length > 64
  )
    throw Error("AI 판단 정보가 올바르지 않습니다.");
  const note = text(d.note, 500),
    candidates = d.candidates.map((c: any) => {
      if (
        !Number.isFinite(c.value) ||
        (c.visits !== undefined &&
          (!Number.isInteger(c.visits) || c.visits < 0 || c.visits > 50000))
      )
        throw Error("판단 후보 값이 올바르지 않습니다.");
      return {
        label: text(c.label),
        value: c.value,
        ...(c.visits !== undefined ? { visits: c.visits } : {}),
      };
    });
  if (
    d.type === "score" &&
    action.type === "score" &&
    d.category === action.category
  )
    return {
      type: "score",
      category: action.category,
      value: d.value,
      note,
      candidates,
    };
  if (
    d.type === "reroll" &&
    action.type === "hold" &&
    Array.isArray(d.ids) &&
    same([...d.ids].sort(), [...action.ids].sort()) &&
    state.rolls < 3
  )
    return {
      type: "reroll",
      ids: [...action.ids],
      value: d.value,
      note,
      candidates,
    };
  throw Error("판단 정보와 실제 행동이 일치하지 않습니다.");
}
export function validateReplay(input: unknown): Replay {
  const raw = object(input);
  // v0.3 exports used the unversioned Match envelope.
  if (
    raw.format === undefined &&
    Array.isArray(raw.algorithms) &&
    raw.algorithms.length === 2 &&
    raw.algorithms.every((a: unknown) => algorithms.includes(a as Algorithm)) &&
    Array.isArray(raw.frames)
  ) {
    return validateReplay(replayFromMatch(raw as unknown as Match));
  }
  if (raw.format !== "YachtLabReplay" || raw.version !== 1)
    throw Error("지원하지 않는 기보 형식 또는 버전입니다.");
  const meta = object(raw.metadata);
  if (
    meta.ruleVersion !== "YachtLab-12-v1" ||
    !Array.isArray(meta.players) ||
    meta.players.length !== 2
  )
    throw Error("지원하지 않는 규칙 또는 플레이어 정보입니다.");
  const players = meta.players.map((p: any) => {
    if (
      !p ||
      !["human", "ai"].includes(p.type) ||
      (p.type === "ai" && !algorithms.includes(p.algorithm))
    )
      throw Error("알 수 없는 플레이어입니다.");
    return {
      name: text(p.name, 80),
      type: p.type,
      ...(p.type === "ai" ? { algorithm: p.algorithm } : {}),
    };
  }) as [Player, Player];
  if (!Number.isFinite(Date.parse(meta.createdAt)))
    throw Error("저장 날짜가 올바르지 않습니다.");
  validateGameShape(raw.initialState);
  let state = createGame(raw.initialState.seed);
  if (
    !same(state, raw.initialState) ||
    !Array.isArray(raw.frames) ||
    raw.frames.length < 1 ||
    raw.frames.length > 4096
  )
    throw Error("기보의 시작 상태가 올바르지 않습니다.");
  const frames: Frame[] = [];
  for (let i = 0; i < raw.frames.length; i++) {
    const f = object(raw.frames[i]);
    if (![0, 1].includes(f.actor))
      throw Error("행동 플레이어가 올바르지 않습니다.");
    const actor = state.player;
    let action: Action | null = null,
      decision: Decision | undefined;
    if (i === 0) {
      if (f.action !== null) throw Error("시작 행동이 올바르지 않습니다.");
    } else {
      action = validateAction(f.action);
      if (f.actor !== actor) throw Error("차례가 아닌 플레이어의 행동입니다.");
      decision = safeDecision(f.decision, action, state);
      state = transition(state, action);
    }
    if (!same(state, f.state))
      throw Error(`${i}번째 행동의 점수·주사위·난수 상태가 일치하지 않습니다.`);
    frames.push({
      state: clone(state),
      action,
      actor,
      label: actionText(action, state, actor),
      actorName: f.actorName ? text(f.actorName, 80) : players[actor].name,
      ...(decision ? { decision } : {}),
    });
  }
  if (!same(state, raw.finalState))
    throw Error("최종 상태가 행동 기록과 일치하지 않습니다.");
  const source = meta.source ? object(meta.source) : undefined;
  if (
    source &&
    (!Number.isInteger(source.frameIndex) ||
      source.frameIndex < 0 ||
      source.frameIndex >= frames.length)
  )
    throw Error("분기 출처가 올바르지 않습니다.");
  return {
    format: "YachtLabReplay",
    version: 1,
    metadata: {
      id: text(meta.id, 100),
      name: text(meta.name, 80),
      createdAt: new Date(meta.createdAt).toISOString(),
      ruleVersion: "YachtLab-12-v1",
      players,
      ...(source
        ? {
            source: {
              replayId: text(source.replayId, 100),
              frameIndex: source.frameIndex,
            },
          }
        : {}),
    },
    initialState: clone(raw.initialState),
    frames,
    finalState: clone(state),
  };
}
export function parseReplay(text: string): Replay {
  if (new TextEncoder().encode(text).byteLength > replayLimit)
    throw Error("기보 파일은 8MiB 이하여야 합니다.");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw Error("올바른 JSON 파일이 아닙니다.");
  }
  return validateReplay(raw);
}
export function downloadReplay(replay: Replay) {
  const value = validateReplay(replay),
    url = URL.createObjectURL(
      new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
    ),
    a = document.createElement("a");
  a.href = url;
  a.download = `YachtLab_${new Date().toLocaleDateString("sv-SE")}_${value.metadata.players[1].name.replace(/[^\w-]/g, "-")}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

import { categories, type Action } from "./engine";
import { createMultiGame, transitionMulti, type MultiGame } from "./multi-engine";
import { validateReplay, type Player } from "./replay";

export const multiReplayLimit = 4 * 1024 * 1024;
export const multiReplayActionLimit = 10000;
export type MultiReplay = {
  format: "YachtLabMultiReplay";
  version: 1 | 2;
  metadata: {
    id: string;
    name: string;
    createdAt: string;
    ruleVersion: "YachtLab-12-multi-v1" | "YachtLab-12-multi-v2";
    players: Player[];
  };
  seed: number;
  actions: Action[];
  finalState: MultiGame;
};

const clone = <T>(value: T): T => structuredClone(value);
const validSeed = (v: unknown): v is number => Number.isInteger(v) && Number(v) >= 0 && Number(v) <= 0xffffffff;
const asObject = (v: unknown): Record<string, any> => {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw Error("기보 객체 형식이 올바르지 않습니다.");
  return v as Record<string, any>;
};
const name = (v: unknown, max = 80): string => {
  if (typeof v !== "string" || !v.trim() || v.length > max) throw Error("기보 이름이 올바르지 않습니다.");
  return v;
};
export function newMultiReplay(state: MultiGame, players: Player[], title = "N인전"): MultiReplay {
  if (players.length !== state.cards.length) throw Error("플레이어 수가 게임 상태와 다릅니다.");
  return {
    format: "YachtLabMultiReplay",
    version: 2,
    metadata: {
      id: crypto.randomUUID(),
      name: title,
      createdAt: new Date().toISOString(),
      ruleVersion: "YachtLab-12-multi-v2",
      players: clone(players),
    },
    seed: state.seed,
    actions: [],
    finalState: clone(state),
  };
}
export function appendMultiAction(replay: MultiReplay, action: Action): MultiReplay {
  if (replay.actions.length >= multiReplayActionLimit) throw Error("기보 행동 수 한도에 도달했습니다.");
  const state = transitionMulti(replay.finalState, action);
  return { ...replay, actions: [...replay.actions, clone(action)], finalState: state };
}
function validAction(raw: unknown): Action {
  const a = asObject(raw);
  if (a.type === "roll" && Object.keys(a).length === 1) return { type: "roll" };
  if ((a.type === "hold" || a.type === "order") && Object.keys(a).length === 2 && Array.isArray(a.ids) && a.ids.length <= 5 && new Set(a.ids).size === a.ids.length && a.ids.every((v: unknown) => Number.isInteger(v) && Number(v) >= 0 && Number(v) <= 4)) return { type: a.type, ids: [...a.ids] };
  if (a.type === "score" && Object.keys(a).length === 2 && categories.includes(a.category)) return { type: "score", category: a.category };
  throw Error("불법 행동이 포함된 기보입니다.");
}
function fromLegacy(raw: unknown): MultiReplay {
  const old = validateReplay(raw);
  const state = createMultiGame(2, old.initialState.seed, true);
  let replay = newMultiReplay(state, old.metadata.players, old.metadata.name);
  replay.version = 1;
  replay.metadata.ruleVersion = "YachtLab-12-multi-v1";
  for (const frame of old.frames.slice(1)) replay = appendMultiAction(replay, frame.action!);
  replay.metadata.createdAt = old.metadata.createdAt;
  return replay;
}
export function validateMultiReplay(raw: unknown): MultiReplay {
  const obj = asObject(raw);
  if (obj.format === "YachtLabReplay" || (obj.format === undefined && Array.isArray(obj.algorithms))) return fromLegacy(obj);
  if (obj.format !== "YachtLabMultiReplay" || (obj.version !== 1 && obj.version !== 2)) throw Error("지원하지 않는 다인전 기보 형식입니다.");
  const meta = asObject(obj.metadata);
  if (meta.ruleVersion !== `YachtLab-12-multi-v${obj.version}` || !Array.isArray(meta.players) || meta.players.length < 2 || meta.players.length > 50) throw Error("기보 참가자 수 또는 규칙이 올바르지 않습니다.");
  const players: Player[] = meta.players.map((value: unknown) => {
    const p = asObject(value);
    if (p.type !== "human" && p.type !== "ai") throw Error("지원하지 않는 참가자 형식입니다.");
    return { type: p.type, name: name(p.name) } as Player;
  });
  if (!validSeed(obj.seed) || !Number.isFinite(Date.parse(meta.createdAt))) throw Error("기보 시드 또는 날짜가 올바르지 않습니다.");
  if (!Array.isArray(obj.actions) || obj.actions.length > multiReplayActionLimit) throw Error("기보 행동 수가 올바르지 않습니다.");
  let state = createMultiGame(players.length, obj.seed, obj.version === 1);
  const actions: Action[] = [];
  for (const rawAction of obj.actions) {
    const action = validAction(rawAction);
    state = transitionMulti(state, action);
    actions.push(action);
  }
  if (JSON.stringify(state) !== JSON.stringify(obj.finalState)) throw Error("기보 최종 상태가 재계산한 결과와 일치하지 않습니다.");
  return {
    format: "YachtLabMultiReplay",
    version: obj.version,
    metadata: {
      id: name(meta.id, 100),
      name: name(meta.name),
      createdAt: new Date(meta.createdAt).toISOString(),
      ruleVersion: meta.ruleVersion,
      players,
    },
    seed: obj.seed,
    actions,
    finalState: state,
  };
}
export function parseMultiReplay(content: string): MultiReplay {
  if (new TextEncoder().encode(content).byteLength > multiReplayLimit) throw Error("기보 파일은 4MiB 이하여야 합니다.");
  let raw: unknown;
  try { raw = JSON.parse(content); } catch { throw Error("올바른 JSON 파일이 아닙니다."); }
  return validateMultiReplay(raw);
}
export function downloadMultiReplay(replay: MultiReplay) {
  const checked = validateMultiReplay(replay);
  const url = URL.createObjectURL(new Blob([JSON.stringify(checked, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "YachtLab_Multi_" + new Date().toLocaleDateString("sv-SE") + ".json";
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function replaySeek(replay: MultiReplay) {
  const checkpoints = new Map<number, MultiGame>();
  let state = createMultiGame(replay.metadata.players.length, replay.seed, replay.version === 1);
  checkpoints.set(0, state);
  replay.actions.forEach((action, i) => {
    state = transitionMulti(state, action);
    if ((i + 1) % 32 === 0 || i === replay.actions.length - 1) checkpoints.set(i + 1, state);
  });
  return (index: number) => {
    if (!Number.isInteger(index) || index < 0 || index > replay.actions.length) throw Error("잘못된 기보 위치입니다.");
    const from = Math.floor(index / 32) * 32;
    let next = checkpoints.get(from)!;
    for (let i = from; i < index; i++) next = transitionMulti(next, replay.actions[i]);
    return next;
  };
}

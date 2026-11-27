import type { Page } from "@playwright/test";
import { categories, createGame, score, transition, type Action, type Game } from "../../src/engine";
import { createSoloGame, transitionMulti, type MultiGame } from "../../src/multi-engine";
import type { MultiReplay } from "../../src/multi-replay";
import type { Replay } from "../../src/replay";

/** A simple human-like policy: keep the most frequent eye, then take the best open category. */
function keepIds(dice: Game["dice"], round: number) {
  const counts = new Map<number, number>();
  for (const { value } of dice) counts.set(value, (counts.get(value) ?? 0) + 1);
  const [eye] = [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
  // Every few rounds hold nothing to vary the record (gives some mistakes and some luck).
  if (round % 5 === 3) return [];
  return dice.filter(({ value }) => value === eye).map(({ id }) => id);
}

function bestOpen(dice: Game["dice"], card: Game["cards"][number]) {
  const values = dice.map(({ value }) => value);
  return categories.filter((category) => card[category] === undefined)
    .sort((a, b) => score(values, b) - score(values, a))[0];
}

type TurnState = { dice: Game["dice"]; cards: Game["cards"][number][]; player: number; round: number };

function playTurn(act: (action: Action) => void, current: () => TurnState) {
  act({ type: "roll" });
  for (let roll = 1; roll < 3; roll++) {
    const now = current();
    const ids = keepIds(now.dice, now.round);
    if (ids.length === 5) break;
    act({ type: "hold", ids });
    act({ type: "roll" });
  }
  const now = current();
  act({ type: "score", category: bestOpen(now.dice, now.cards[now.player]) });
}

export function aiReplay(names: [string, string] = ["복기A", "요트봇"], id = "review-ai-fixture", seed = 40): Replay {
  const initialState = createGame(seed, true);
  const players: Replay["metadata"]["players"] = [{ name: names[0], type: "human" }, { name: names[1], type: "ai", algorithm: "DP Expert" }];
  const replay: Replay = {
    format: "YachtLabReplay", version: 2,
    metadata: { id, name: "리뷰 테스트", createdAt: new Date().toISOString(), ruleVersion: "YachtLab-12-v2", players },
    initialState, finalState: initialState,
    frames: [{ state: initialState, action: null, actor: 0, label: "시작", actorName: players[0].name }],
  };
  const act = (action: Action) => {
    const { player } = replay.finalState;
    replay.finalState = transition(replay.finalState, action);
    replay.frames.push({ action, state: replay.finalState, actor: player, label: action.type, actorName: players[player].name });
  };
  while (!replay.finalState.done) playTurn(act, () => replay.finalState);
  return replay;
}

export function soloReplay(name = "혼자요트", id = "review-solo-fixture", seed = 77): MultiReplay {
  let state: MultiGame = createSoloGame(seed);
  const actions: Action[] = [];
  const act = (action: Action) => { state = transitionMulti(state, action); actions.push(action); };
  while (!state.done) playTurn(act, () => state);
  return {
    format: "YachtLabMultiReplay", version: 2,
    metadata: { id, name: "1인 플레이", createdAt: new Date().toISOString(), ruleVersion: "YachtLab-12-multi-v2", players: [{ name, type: "human" }] },
    seed, actions, finalState: state,
  };
}

async function put(page: Page, database: string, record: unknown) {
  await page.evaluate(async ({ database, record }) => {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(database, 1);
      req.onupgradeneeded = () => req.result.createObjectStore("replays", { keyPath: "metadata.id" });
      req.onsuccess = () => {
        const transaction = req.result.transaction("replays", "readwrite");
        transaction.objectStore("replays").put(record);
        transaction.oncomplete = () => { req.result.close(); resolve(); };
        transaction.onerror = () => reject(transaction.error);
      };
      req.onerror = () => reject(req.error);
    });
  }, { database, record });
}

export async function seedReplays(page: Page, { ai = [], solo = [] }: { ai?: Replay[]; solo?: MultiReplay[] }) {
  await page.goto("#records");
  for (const replay of ai) await put(page, "YachtLabReplays", replay);
  for (const replay of solo) await put(page, "YachtLabMultiReplays", replay);
  await page.getByRole("button", { name: "새로고침" }).click();
}

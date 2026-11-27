/**
 * One-off generator of the frozen legacy-format review fixtures (2026-11-27). The JSON files are the
 * regression inputs; do not regenerate them to make a test pass.
 *   npx tsx tests/fixtures/review-legacy/generate.ts
 * - ai-replay-v1.json: YachtLabReplay v1 (YachtLab-12-v1, both seats share one dice stream).
 * - local-multi-v1.json: YachtLabMultiReplay v1 (YachtLab-12-multi-v1, legacy seed stream), 1:1 local.
 * - account-archive-legacy.json: ReviewMatch as the account archive stored it before roll context:
 *   no firstRoll / unpairedFirstRolls / looks / device; first dice live on the first decision.
 */
import { writeFileSync } from "node:fs";
import { categories, createGame, score, transition, type Action, type Game } from "../../../src/engine";
import { createMultiGame, transitionMulti, type MultiGame } from "../../../src/multi-engine";
import { fromReplay } from "../../../src/review/sources";
import type { MultiReplay } from "../../../src/multi-replay";
import type { Replay } from "../../../src/replay";

const out = new URL(".", import.meta.url);
const created = "2026-05-01T09:00:00.000Z";

function play(act: (a: Action) => void, now: () => { dice: Game["dice"]; cards: Game["cards"][number][]; player: number; round: number; done: boolean }) {
  while (!now().done) {
    act({ type: "roll" });
    for (let roll = 1; roll < 3; roll++) {
      const { dice, round } = now();
      const counts = new Map<number, number>();
      for (const { value } of dice) counts.set(value, (counts.get(value) ?? 0) + 1);
      const [eye] = [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
      const ids = round % 4 === 2 ? [] : dice.filter(({ value }) => value === eye).map(({ id }) => id);
      if (ids.length === 5) break;
      act({ type: "hold", ids });
      act({ type: "roll" });
    }
    const { dice, cards, player } = now();
    const values = dice.map(({ value }) => value);
    const category = categories.filter((c) => cards[player][c] === undefined).sort((a, b) => score(values, b) - score(values, a))[0];
    act({ type: "score", category });
  }
}

const initialState = createGame(2024);
const players: Replay["metadata"]["players"] = [{ name: "옛기록", type: "human" }, { name: "DP Expert", type: "ai", algorithm: "DP Expert" }];
const replay: Replay = {
  format: "YachtLabReplay", version: 1,
  metadata: { id: "legacy-ai-v1", name: "이전 형식 AI 대국", createdAt: created, ruleVersion: "YachtLab-12-v1", players },
  initialState, finalState: initialState,
  frames: [{ state: initialState, action: null, actor: 0, label: "경기 준비", actorName: players[0].name }],
};
play((action) => {
  const { player } = replay.finalState;
  replay.finalState = transition(replay.finalState, action);
  replay.frames.push({ action, state: replay.finalState, actor: player, label: action.type, actorName: players[player].name });
}, () => replay.finalState);
writeFileSync(new URL("ai-replay-v1.json", out), JSON.stringify(replay));

let multi: MultiGame = createMultiGame(2, 777, true);
const actions: Action[] = [];
play((action) => { multi = transitionMulti(multi, action); actions.push(action); }, () => multi);
const local: MultiReplay = {
  format: "YachtLabMultiReplay", version: 1,
  metadata: { id: "legacy-local-v1", name: "이전 형식 로컬 대전", createdAt: created, ruleVersion: "YachtLab-12-multi-v1",
    players: [{ name: "철수", type: "human" }, { name: "철수", type: "human" }] },
  seed: 777, actions, finalState: multi,
};
writeFileSync(new URL("local-multi-v1.json", out), JSON.stringify(local));

const match = fromReplay(replay);
if (typeof match === "string") throw Error(match);
const archive = {
  id: "legacy-archive", players: match.players, scores: match.scores, winners: match.winners, me: 0,
  steps: match.steps.map(({ firstRoll: _drop, ...step }) => step),
};
writeFileSync(new URL("account-archive-legacy.json", out), JSON.stringify(archive));

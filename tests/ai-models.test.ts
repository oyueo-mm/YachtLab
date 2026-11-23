import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { available, categories, createGame, total, transition, type Game } from "../src/engine";
import { algorithms, decide } from "../src/ai";
import { setDPTable } from "../src/dp";
import manifest from "../src/dp-manifest.json";
import { decideModel, isLegalDecision, isModelId, isSelectable, modelInfo, modelNeedsDP, modelRegistry, researchModelIds, type ModelId } from "../src/ai-models";
import { appendFrame, newReplay, validateReplay } from "../src/replay";
import { sanitizeAiSetup } from "../src/setup";

const bytes = gunzipSync(readFileSync("public/ai/" + manifest.asset));
setDPTable(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));

/** Mid-game state with `left` categories open for the side to move, dice rolled. */
function state(seed: number, left: number): Game {
  const s = transition(createGame(seed, true), { type: "roll" });
  const open = new Set(categories.slice(-left));
  s.cards = s.cards.map(() => Object.fromEntries(categories.filter((c) => !open.has(c)).map((c) => [c, 3]))) as Game["cards"];
  return s;
}
const key = (d: { type: string; category?: string; ids?: number[] }) => (d.type === "score" ? "s:" + d.category : "k:" + [...(d.ids ?? [])].sort().join(","));

describe("AI model registry", () => {
  it("keeps every shipped algorithm playable and lists research models without duplicates", () => {
    const ids = modelRegistry.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const a of algorithms) expect(modelInfo(a)).toMatchObject({ status: "playable" });
    for (const id of researchModelIds) {
      const m = modelInfo(id)!;
      expect(["playable", "conditional"]).toContain(m.status);
      if (m.status === "conditional") {
        expect(m.condition).toBeTruthy();
        expect(m.fallback).toBeTruthy();
      }
      expect(isSelectable(id)).toBe(true);
    }
    for (const m of modelRegistry.filter((x) => x.status === "research")) {
      expect(m.reason).toBeTruthy();
      expect(isSelectable(m.id)).toBe(false);
      expect(isModelId(m.id)).toBe(false);
    }
    expect(modelRegistry.every((m) => m.rules.join() === "yacht-12")).toBe(true);
  });

  it("only the five public difficulty models are marked as public levels", () => {
    expect(modelRegistry.filter((m) => m.publicLevel).map((m) => m.id).sort()).toEqual(["Expectimax", "Greedy", "PPO", "Random", "Win DP v4-D"].sort());
  });

  it("research ids are accepted by setup and replays, unknown ids are not", () => {
    expect(sanitizeAiSetup({ researchAlgorithm: "Win DP v4" }).researchAlgorithm).toBe("Win DP v4");
    expect(sanitizeAiSetup({ researchAlgorithm: "rl-zoo-choice" }).researchAlgorithm).toBe("DP Expert");
    expect(sanitizeAiSetup({ researchAlgorithm: "nope" }).researchAlgorithm).toBe("DP Expert");
    expect(() => decideModel(state(1, 12), "nope" as ModelId)).toThrow();
    const game = createGame(9, true);
    let replay = newReplay(game, [{ type: "human", name: "나" }, { type: "ai", name: "Win DP v4", algorithm: "Win DP v4" }], "요트 대국", 2);
    replay = appendFrame(replay, { type: "roll" });
    const parsed = validateReplay(JSON.parse(JSON.stringify(replay)));
    expect(parsed.metadata.players[1]).toMatchObject({ type: "ai", algorithm: "Win DP v4" });
  });

  it("legality check matches the engine", () => {
    const s = state(3, 12);
    expect(isLegalDecision(s, { type: "score", category: "aces", value: 0, candidates: [], note: "" })).toBe(true);
    expect(isLegalDecision({ ...s, cards: [{ aces: 1 }, {}] }, { type: "score", category: "aces", value: 0, candidates: [], note: "" })).toBe(false);
    expect(isLegalDecision(s, { type: "reroll", ids: [0, 0], value: 0, candidates: [], note: "" })).toBe(false);
    expect(isLegalDecision(s, { type: "reroll", ids: [9], value: 0, candidates: [], note: "" })).toBe(false);
    expect(isLegalDecision(s, { type: "reroll", ids: [0, 1, 2, 3, 4], value: 0, candidates: [], note: "" })).toBe(true); // engine allows keeping all
    expect(isLegalDecision({ ...s, rolls: 3 }, { type: "reroll", ids: [], value: 0, candidates: [], note: "" })).toBe(false);
  });
});

describe("every connected research model plays complete, legal games", () => {
  for (const id of researchModelIds)
    it(`${id}: full game vs Greedy, legal moves only, its own decisions, no hidden-RNG use`, () => {
      expect(modelNeedsDP(id) || !modelInfo(id)!.needsDP).toBe(true);
      for (const seat of [0, 1] as const) {
        let s = createGame(100 + seat, true);
        let steps = 0;
        while (!s.done) {
          expect(steps++).toBeLessThan(250); // no endless loops
          if (!s.rolls) {
            s = transition(s, { type: "roll" });
            continue;
          }
          const d = s.player === seat ? decideModel(s, id) : decide(s, "Greedy");
          if (s.player === seat) {
            expect(isLegalDecision(s, d)).toBe(true);
            expect(d.note.startsWith(id)).toBe(true); // the selected model really decided
            expect(d.note).not.toContain("안전 대체");
          }
          if (d.type === "score") s = transition(s, { type: "score", category: d.category });
          else {
            s = transition(s, { type: "hold", ids: d.ids });
            s = transition(s, { type: "roll" });
          }
        }
        for (const card of s.cards) expect(available(card)).toEqual([]);
        expect(total(s.cards[seat])).toBeGreaterThan(0);
      }
      // Representative early / middle / late states: same decision when hidden seed/RNG differ.
      for (const left of [12, 6, 3, 2, 1]) {
        const s = state(7 + left, left);
        const a = decideModel(s, id),
          b = decideModel({ ...s, seed: 123, rng: [77, 99] }, id);
        expect(isLegalDecision(s, a)).toBe(true);
        expect(key(a)).toBe(key(b));
      }
    }, 120000);
});

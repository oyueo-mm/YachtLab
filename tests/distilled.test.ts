import { beforeAll, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import policyModel from "../src/distilled-policy.json";
import ppoModel from "../src/distilled-ppo.json";
import {
  loadDistilled,
  distilledPolicy,
  distilledDecision,
} from "../src/distilled";
import { createGame, transition, categories } from "../src/engine";
import { simulate } from "../src/match";
beforeAll(async () => {
  await loadDistilled("Distilled Policy");
  await loadDistilled("Distilled PPO");
});
it("canonical observation probabilities match actual PyTorch exports for both policies", () => {
  for (const [name, model] of [
    ["Distilled Policy", policyModel],
    ["Distilled PPO", ppoModel],
  ] as const) {
    const s = {
      ...createGame(123),
      rolls: model.fixture.rolls,
      dice: model.fixture.dice.map((value, id) => ({ id, value, held: false })),
    };
    distilledPolicy(s, name).forEach((p, i) =>
      expect(p).toBeCloseTo(model.fixture.probabilities[i], 5),
    );
    expect(distilledPolicy(s, name).reduce((a, b) => a + b, 0)).toBeCloseTo(
      1,
      12,
    );
  }
});
it("masks unavailable scores and rerolls, and ignores visual order", () => {
  let s = transition(createGame(78), { type: "roll" });
  s = { ...s, rolls: 3, cards: [{ aces: 0, choice: 20 }, {}] };
  for (const name of ["Distilled Policy", "Distilled PPO"] as const) {
    const p = distilledPolicy(s, name);
    expect(p.slice(0, 32).every((x) => x === 0)).toBe(true);
    expect(p[32]).toBe(0);
    expect(p[38]).toBe(0);
    expect(distilledPolicy({ ...s, order: [4, 3, 2, 1, 0] }, name)).toEqual(p);
    const d = distilledDecision(s, name);
    expect(d.type).toBe("score");
    if (d.type === "score") expect(s.cards[0][d.category]).toBeUndefined();
  }
});
it("canonical hold decisions preserve equivalent faces under die permutations", () => {
  const s = {
    ...transition(createGame(13), { type: "roll" }),
    dice: [2, 5, 2, 6, 3].map((value, id) => ({ id, value, held: false })),
  };
  const swapped = {
    ...s,
    dice: [6, 2, 3, 2, 5].map((value, id) => ({ id, value, held: false })),
  };
  for (const name of ["Distilled Policy", "Distilled PPO"] as const) {
    const a = distilledDecision(s, name),
      b = distilledDecision(swapped, name);
    expect(a.type).toBe(b.type);
    if (a.type === "reroll" && b.type === "reroll")
      expect(a.ids.map((id) => s.dice[id].value).sort()).toEqual(
        b.ids.map((id) => swapped.dice[id].value).sort(),
      );
    if (a.type === "score" && b.type === "score")
      expect(a.category).toBe(b.category);
  }
});
it("both learned policies complete legal games using the unchanged engine", () => {
  const m = simulate(["Distilled Policy", "Distilled PPO"], 712);
  expect(m.frames.at(-1)!.state.done).toBe(true);
  expect(Object.keys(m.frames.at(-1)!.state.cards[0])).toHaveLength(
    categories.length,
  );
});
it("published model files retain their recorded checksums", () => {
  const r = JSON.parse(
    readFileSync("training/distillation-results.json", "utf8"),
  );
  for (const model of Object.values(r.artifacts) as {
    file: string;
    sha256: string;
  }[])
    expect(
      createHash("sha256").update(readFileSync(model.file)).digest("hex"),
    ).toBe(model.sha256);
});

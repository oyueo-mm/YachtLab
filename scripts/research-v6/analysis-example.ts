// Writes example payloads of the versioned "yachtlab-analysis-v6" contract for UI developers.
//   npx tsx scripts/research-v6/analysis-example.ts
import { writeFileSync } from "node:fs";
import { createGame, transition, type Game } from "../../src/engine.ts";
import * as dp from "../../src/dp.ts";
import { loadDPExpertBank } from "../research-v5/bank-io.ts";
import { loadRiskBanks, DEFAULT_LAMBDAS } from "./banks.ts";
import { analyzeV6, decomposeStep, V6_LIVE, V6_REVIEW } from "../../src/research-v6/analysis6.ts";
import { winDPv5Decision } from "../../src/research-v5/apex.ts";
import type { V6Config } from "../../src/research-v6/apex6.ts";
const { bank, T } = loadDPExpertBank(false);
dp.setDPTable(T.buffer.slice(0) as ArrayBuffer);
const cfg = { bank, dpValue: (m: number, u: number) => T[m * 64 + u], endgame: "none", dpDecision: dp.dpDecision, banks: loadRiskBanks(DEFAULT_LAMBDAS) } as V6Config;
// play a v5-R self-play game (dev seed family 9099) and stop at a mid-game and an endgame position
let s: Game = createGame(0x5eed9099, true);
const snaps: Record<string, Game> = {};
let before: Game | null = null, played: { type: "reroll"; ids: number[] } | null = null, after: Game | null = null;
while (!s.done) {
  if (!s.rolls) { s = transition(s, { type: "roll" }); continue; }
  const view = { ...s, seed: 0, rng: [0, 0] as [number, number] };
  const filled = Object.keys(s.cards[s.player]).length;
  if (filled === 5 && !snaps.mid && s.rolls === 1) snaps.mid = view;
  if (filled === 10 && !snaps.end && s.rolls === 1) snaps.end = view;
  const d = winDPv5Decision(view, { ...cfg, endgame: "none" });
  if (d.type === "reroll" && filled === 5 && !before) { before = view; played = { type: "reroll", ids: d.ids }; }
  s = d.type === "score" ? transition(s, { type: "score", category: d.category }) : transition(transition(s, { type: "hold", ids: d.ids }), { type: "roll" });
  if (before && !after && s.player === before.player && s.rolls === before.rolls + 1) after = { ...s, seed: 0, rng: [0, 0] };
}
const trim = (a: ReturnType<typeof analyzeV6>) => ({ ...a, actions: a.actions.slice(0, 8), actionsTotal: a.actions.length, scoreDiffDPExpert: { offset: a.scoreDiffDPExpert.offset, pmfLength: a.scoreDiffDPExpert.pmf.length, pmfFirst10: a.scoreDiffDPExpert.pmf.slice(0, 10) } });
const out = {
  note: "Example payloads of yachtlab-analysis-v6 (research engine). actions are truncated to the top 8 here; the API returns every legal action. Values are model values, not true optimal win rates.",
  engines: { V6_LIVE, V6_REVIEW },
  midGameReview: trim(analyzeV6(snaps.mid, cfg, V6_REVIEW)),
  midGameLive: trim(analyzeV6(snaps.mid, cfg, V6_LIVE)),
  endgameReview: trim(analyzeV6(snaps.end, cfg, V6_REVIEW)),
  decisionVsLuck: before && after ? decomposeStep(before, played!, after, cfg) : null,
};
writeFileSync("docs/context/examples/analysis-v6-example.json", JSON.stringify(out, null, 1));
console.log(JSON.stringify({ mid: out.midGameReview.model.stage, midMs: out.midGameReview.budget.elapsedMs, liveMs: out.midGameLive.budget.elapsedMs, end: out.endgameReview.exactness.kind, endMs: out.endgameReview.budget.elapsedMs, luck: out.decisionVsLuck }));

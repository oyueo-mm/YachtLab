import { createGame } from "../engine";
import { analyzeV6, decomposeStep, type V6Analysis } from "../research-v6/analysis6";
import type { V6Config } from "../research-v6/apex6";
import type { V5Config } from "../research-v5/apex";
import { assessSituation } from "./solver";
import type { Assessment, Position, Situation, Value } from "./model";

// Research comparison found no reason to use deeper fixed-opponent search as the product default.
const reviewEngine = { name: "v5-r-review", depth: 1, brWindow: 0, minimaxWindow: 1, budgetMs: 5000 };
const game = (position: Position) => ({ ...createGame(0), ...position });
const clamp = (value: number) => Math.min(1, Math.max(0, value));
const keptKey = (position: Position, ids: number[]) =>
  position.dice.filter(({ id }) => ids.includes(id)).map(({ value }) => value).sort().join("");

function actionKey(position: Position, action: Value["action"]) {
  return action.type === "score" ? action.category : keptKey(position, action.ids);
}

export function analyzeProductSituation(situation: Situation, index: number, base: V5Config): Assessment {
  const row = assessSituation(situation, index);
  const { before, action, afterRoll } = situation;
  // Separate players may be choosing at once. Their snapshots cannot establish an interactive game tree.
  if (before.simultaneous) return row;

  const config: V6Config = { ...base, banks: [base.bank] };
  const analysis = analyzeV6(game(before), config, reviewEngine);
  const found = new Map(analysis.actions.map((option) => [
    option.kind === "score" ? option.category : keptKey(before, option.ids!),
    option,
  ]));
  let spentRoll: V6Analysis | undefined;
  const options = row.options.map((option): Value => {
    if (option.action.type === "reroll" && option.action.ids.length === 5) {
      // The engine also allows spending a roll while retaining every die. No future outcomes are needed.
      spentRoll ??= analyzeV6(game({ ...before, rolls: before.rolls + 1 }), config, reviewEngine);
      const best = spentRoll.actions[0];
      return {
        ...option, winCredit: clamp(best.winCredit), winExpected: best.expectedFinal,
        winOutcomes: outcomes(best),
      };
    }
    // Equivalent keeps (same eyes using different ids) have one V6 value.
    const match = found.get(actionKey(before, option.action));
    if (!match) return option;
    return { ...option, winCredit: clamp(match.winCredit), winExpected: match.expectedFinal, winOutcomes: outcomes(match) };
  });
  const actual = options.find((option) => option.action === row.actual.action)!;
  let winLuck: number | undefined;
  if (action.type === "reroll" && afterRoll?.player === before.player && actual.winCredit !== undefined) {
    const canonical = found.get(actionKey(before, action));
    winLuck = canonical?.ids
      ? decomposeStep(game(before), { type: "reroll", ids: canonical.ids }, game(afterRoll), config, reviewEngine).luck
      : clamp(analyzeV6(game(afterRoll), config, reviewEngine).currentValue) - actual.winCredit;
  }
  const { offset, pmf } = analysis.scoreDiffDPExpert;
  return {
    ...row, options, actual, winLuck,
    preRollValue: Number.isFinite(analysis.preRollValue) ? clamp(analysis.preRollValue) : undefined,
    exactness: analysis.exactness.kind === "exact-interactive" ? "exact" : "estimate",
    distribution: pmf.flatMap((mass, i) => mass > 0 ? [{ difference: offset + i, mass }] : []),
  };
}

function outcomes(action: V6Analysis["actions"][number]): Value["winOutcomes"] {
  if (action.pWin === null || action.pTie === null || action.pLoss === null) return undefined;
  const sum = action.pWin + action.pTie + action.pLoss;
  return { win: action.pWin / sum, tie: action.pTie / sum, loss: action.pLoss / sum };
}

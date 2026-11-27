import { categories, createGame } from "../engine";
import { analyzeV6, type V6Analysis } from "../research-v6/analysis6";
import type { V6Config } from "../research-v6/apex6";
import { winDPv5Decision, type V5Config } from "../research-v5/apex";
import { assessOpening, assessSituation } from "./solver";
import { firstRollPosition, type Assessment, type OpeningAssessment, type Position, type Situation, type Value } from "./model";

// Research comparison found no reason to use deeper fixed-opponent search as the product default.
const reviewEngine = { name: "v5-r-review", depth: 1, brWindow: 0, minimaxWindow: 0, budgetMs: 5000 };
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
  const firstRoll = firstRollPosition(situation);
  if (row.exactness === "exact") return row;

  // The approximate branch uses one fixed opponent continuation, including for simultaneous turns.
  const config: V6Config = { ...base, endgame: "none", banks: [base.bank] };
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
  // Freeze the opponent's public card at commitment: intervening scores are not dice luck.
  const rolled = afterRoll && action.type === "reroll" && afterRoll.player === before.player && actual.winCredit !== undefined
    ? winDPv5Decision(game({ ...afterRoll, cards: before.cards }), config)
    : undefined;
  const opening = firstRoll
    ? firstRoll.cards.every((card, seat) => categories.every((category) => card[category] === before.cards[seat][category]))
      ? analysis
      : analyzeV6(game(firstRoll), config, reviewEngine)
    : undefined;
  const winLuck = rolled && actual.winCredit !== undefined ? clamp(rolled.value) - actual.winCredit : undefined;
  const { offset, pmf } = analysis.scoreDiffDPExpert;
  return {
    ...row, options, actual, winLuck, ...(opening ? winOpening(opening) : {}),
    exactness: "estimate",
    distribution: pmf.flatMap((mass, i) => mass > 0 ? [{ difference: offset + i, mass }] : []),
  };
}

function outcomes(action: V6Analysis["actions"][number]): Value["winOutcomes"] {
  if (action.pWin === null || action.pTie === null || action.pLoss === null) return undefined;
  const sum = action.pWin + action.pTie + action.pLoss;
  return { win: action.pWin / sum, tie: action.pTie / sum, loss: action.pLoss / sum };
}

function winOpening(analysis: V6Analysis): OpeningAssessment {
  if (!Number.isFinite(analysis.preRollValue)) return {};
  const preRollValue = clamp(analysis.preRollValue);
  return { preRollValue, firstWinLuck: clamp(analysis.currentValue) - preRollValue, exactness: "estimate" };
}

export function analyzeProductOpening(position: Position, base: V5Config): OpeningAssessment {
  const result = assessOpening(position);
  if (result.exactness === "exact") return result;
  const analysis = analyzeV6(game(position), { ...base, endgame: "none", banks: [base.bank] }, reviewEngine);
  return { ...result, ...winOpening(analysis) };
}

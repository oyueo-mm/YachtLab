import {available,type Game} from "./engine";
import type {Decision} from "./ai";
import {dpDecision} from "./dp";
import {winDPv2Decision} from "./competitive-v2";
import {winDPv3Decision} from "./competitive-v3";
import {analyzeExactLastTurn} from "./research-last-turn-br";
import {researchGuidedDecision} from "./research-guided-mcts";

// Every candidate is research-only. No strategy may access hidden dice/RNG.
// Last-turn BR is proven optimal ONLY against the exact known last-turn
// Win DP policy. Do not apply it against unrecognized opponents.
export type SotaResearchVariant="baseline-v2"|"conditional-br-v21"|"calibrated-v3"|"dp-guided-mcts";
export const sotaResearchVariants=["baseline-v2","conditional-br-v21","calibrated-v3","dp-guided-mcts"] as const;
export const baselineResearchDecision=(state:Game):Decision=>winDPv2Decision(state)??dpDecision(state);
export type SotaResearchOptions={opponent:"Win DP v2"|"DP Expert"|"Other";iterations?:number};
export function researchSotaDecision(state:Game,variant:SotaResearchVariant,opts:SotaResearchOptions):Decision{
 if(state.done||state.rolls<1)throw Error("SOTA research decision requires visible rolled state");
 const baseline=()=>baselineResearchDecision(state);
 if(variant==="baseline-v2")return baseline();
 if(variant==="conditional-br-v21"){
  // The v2 last-category policy delegates to Win DP, hence the exact
  // final-response BR applies to opponent's final v2 action as well.
  if(opts.opponent!=="Win DP v2")return baseline();
  const result=analyzeExactLastTurn(state);
  if(result&&result.gain>1e-10&&result.different)return result.decision;
  return baseline();
 }
 if(variant==="calibrated-v3"){
  if(available(state.cards[state.player]).length!==3)return baseline();
  // Forecast is a documented approximation for opponents with >2 categories.
  return winDPv3Decision(state)??baseline();
 }
 if(variant==="dp-guided-mcts"){
  if(available(state.cards[state.player]).length!==3)return baseline();
  return researchGuidedDecision(state,opts.iterations??48);
 }
 throw Error("Unrecognized research variant");
}

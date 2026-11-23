import { available, type Game } from "./engine";
import { algorithms, decide, type Algorithm, type Decision, type Options } from "./ai";
import { dpDecision } from "./dp";
import { winDPv2Decision } from "./competitive-v2";
import { winDPv3Decision } from "./competitive-v3";
import { winDPv31Decision } from "./research-v31";
import { winDPv32Decision } from "./research-v32";
import { winDPv33Decision } from "./research-v33";
import { winDPv33BeliefDecision } from "./research-v33-belief";
import { createOpponentBelief } from "./research-opponent-belief";
import { winDPv34Decision } from "./research-v34";
import { budgetedV34Decision } from "./research-v34-adaptive";
import { winDPv4Decision, type V4Model } from "./research-v4";
import { researchGuidedDecision } from "./research-guided-mcts";
import { researchSotaDecision } from "./research-sota-hybrids";
import { exactLastTurnBRDecision } from "./research-last-turn-br";
import { externalChallengerDecision } from "./external-challengers";
import { discoveredExternalDecision } from "./discovered-external";
import originalV4 from "../training/research-archive/v4-original-seed0.json";
import { isModelId, type ModelId, type ResearchModelId } from "./model-catalog";
export * from "./model-catalog";

/* ------------------------------------------------------------------ decisions ------------------------------------------------------------------ */

const baseline = (s: Game): Decision => winDPv2Decision(s) ?? dpDecision(s);
const v4Original: V4Model = { ...(originalV4 as unknown as V4Model), version: 1 };
const prior = createOpponentBelief();

function researchDecision(s: Game, id: ResearchModelId): Decision {
  switch (id) {
    case "Win DP v3":
      return winDPv3Decision(s) ?? baseline(s);
    case "Win DP v3.1":
      return winDPv31Decision(s, "Other");
    case "Win DP v3.2":
      return winDPv32Decision(s, "Other");
    case "Win DP v3.3":
      return winDPv33Decision(s, "Other");
    case "Win DP v3.3 Belief":
      return winDPv33BeliefDecision(s, prior);
    case "Win DP v3.4":
      return winDPv34Decision(s, "Other", { maxMs: 1500 });
    case "Win DP v3.4 Adaptive":
      return budgetedV34Decision(s, "Other", "adaptive");
    case "Win DP v4":
      return winDPv4Decision(s, "Other", v4Original, { disableV34: true });
    case "DP-guided MCTS":
      return researchGuidedDecision(s, 64);
    case "Hybrid Conditional BR":
      return researchSotaDecision(s, "conditional-br-v21", { opponent: "Other" });
    case "Hybrid Calibrated v3":
      return researchSotaDecision(s, "calibrated-v3", { opponent: "Other" });
    case "Hybrid DP-guided MCTS":
      return researchSotaDecision(s, "dp-guided-mcts", { opponent: "Other" });
    case "Exact Last-Turn BR":
      return exactLastTurnBRDecision(s) ?? baseline(s);
    case "RustHeuristic12":
    case "RustOptimalEquivalent12":
    case "PanchtWeighted12":
    case "BenjiWinObjective12":
      return externalChallengerDecision(s, id);
    case "Z7DartHard12":
    case "Z7DartMedium12":
      return discoveredExternalDecision(s, id);
  }
}

/** A move the 12-category engine accepts in this state. */
export function isLegalDecision(s: Game, d: Decision): boolean {
  if (!d || (d.type !== "score" && d.type !== "reroll")) return false;
  if (d.type === "score") return available(s.cards[s.player]).includes(d.category);
  const ids = d.ids;
  // Keeping all five and spending the roll is legal in the engine (values stay); some ported AIs do it.
  return s.rolls < 3 && Array.isArray(ids) && ids.length <= 5 && new Set(ids).size === ids.length && ids.every((id) => s.dice.some((x) => x.id === id));
}

/**
 * Decide with any registered model. Every move is checked against the rules; a model that throws
 * or proposes an illegal move is replaced for that move by DP Expert (or Greedy when DP is not
 * loaded), and the note says so — the game can always finish.
 */
export function decideModel(s: Game, id: ModelId, options: Options = {}): Decision {
  if ((algorithms as readonly string[]).includes(id)) return decide(s, id as Algorithm, options);
  if (!isModelId(id)) throw Error(`알 수 없는 AI 모델: ${id}`);
  let decision: Decision | null = null,
    problem = "";
  try {
    decision = researchDecision(s, id as ResearchModelId);
    if (!isLegalDecision(s, decision)) {
      problem = "규칙에 맞지 않는 행동을 제안";
      decision = null;
    }
  } catch (e) {
    problem = e instanceof Error ? e.message : String(e);
  }
  if (decision) return { ...decision, note: `${id} · ${decision.note}` };
  let safe: Decision;
  try {
    safe = dpDecision(s);
  } catch {
    safe = decide(s, "Greedy");
  }
  return { ...safe, note: `${id}이(가) 이 상태에서 결정하지 못해(${problem}) 안전 대체 정책을 사용했습니다 · ${safe.note}` };
}

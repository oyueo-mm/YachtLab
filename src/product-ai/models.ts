import type { Game } from "../engine";

export const productV5 = { id: "win-dp-v5-r", version: "v5-research-2026-11-25.1-wasm-f32.1" } as const;
export const productV4 = { id: "win-dp-v4-d", version: "checkpoint-1" } as const;

/** Explicit opt-in while the mobile rollout gates are open. */
export function v5TrialEnabled() {
  const requested = new URLSearchParams(location.search).get("ai-model");
  try {
    if (requested === "v5-r") sessionStorage.setItem("yachtlab.product-ai.v5-trial", "1");
    if (requested === "standard") sessionStorage.removeItem("yachtlab.product-ai.v5-trial");
    return sessionStorage.getItem("yachtlab.product-ai.v5-trial") === "1";
  } catch {
    return requested === "v5-r";
  }
}

export function publicDecisionState(state: Game): Game {
  return { ...state, seed: 0, rng: [0, 0] };
}

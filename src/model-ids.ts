/**
 * IDs of research models that can be selected as an opponent (see src/ai-models.ts for metadata
 * and decision functions). Kept dependency-free so that the main bundle (setup screen, replay
 * validation) can know the IDs without loading any research code.
 */
export const researchModelIds = [
  "Win DP v3",
  "Win DP v3.1",
  "Win DP v3.2",
  "Win DP v3.3",
  "Win DP v3.3 Belief",
  "Win DP v3.4",
  "Win DP v3.4 Adaptive",
  "Win DP v4",
  "DP-guided MCTS",
  "Hybrid Conditional BR",
  "Hybrid Calibrated v3",
  "Hybrid DP-guided MCTS",
  "Exact Last-Turn BR",
  "RustHeuristic12",
  "RustOptimalEquivalent12",
  "PanchtWeighted12",
  "BenjiWinObjective12",
  "Z7DartHard12",
  "Z7DartMedium12",
] as const;
export type ResearchModelId = (typeof researchModelIds)[number];
export const isResearchModelId = (id: unknown): id is ResearchModelId => (researchModelIds as readonly unknown[]).includes(id);
/** Research models whose decisions need the DP table loaded in the worker. */
export const researchModelsNeedingDP: readonly ResearchModelId[] = researchModelIds.filter(
  (id) => !["RustHeuristic12", "PanchtWeighted12", "Z7DartHard12", "Z7DartMedium12"].includes(id),
);

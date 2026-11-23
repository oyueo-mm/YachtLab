/**
 * Ruleset registry (see docs/rules/RULESET-EXTENSION.md).
 * Only the existing 12-category Yacht Dice is playable. Other entries are listed as
 * "not available" so the setup screen can show the structure without offering them.
 * The game engine itself is untouched: `yacht-12` maps to src/engine.ts as-is.
 */
export type RulesetId = "yacht-12" | "yahtzee-13";
export type RulesetInfo = { id: RulesetId; version: number; name: string; summary: string; available: boolean };

export const rulesets: readonly RulesetInfo[] = [
  { id: "yacht-12", version: 1, name: "요트 다이스 12칸", summary: "주사위 5개 · 3번 굴림 · 상단 63점 이상 +35", available: true },
  { id: "yahtzee-13", version: 0, name: "13칸 규칙", summary: "준비 중 — 아직 선택할 수 없어요", available: false },
];

export const DEFAULT_RULESET: RulesetId = "yacht-12";
export const isPlayableRuleset = (id: unknown): id is RulesetId => rulesets.some((r) => r.id === id && r.available);

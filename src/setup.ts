import { useSyncExternalStore } from "react";
import { algorithms, type Algorithm } from "./ai";
import { gameDifficulties } from "./GameDifficulty";
import { DEFAULT_RULESET, isPlayableRuleset, type RulesetId } from "./rulesets";

/**
 * Pre-game setup for offline modes. Values are kept per browser so that going back and forth
 * between the setup and the game never loses input, and so that `#play` / `#pvp` deep links
 * start a game with the last confirmed setup.
 */
export type FirstPlayer = "random" | "me" | "ai";
export type AiSpeed = "slow" | "normal" | "fast";
export type AiSetup = {
  ruleset: RulesetId;
  difficulty: Algorithm;
  name: string;
  first: FirstPlayer;
  /** Advanced: pick any research algorithm instead of the 5 public difficulties. */
  research: boolean;
  researchAlgorithm: Algorithm;
  speed: AiSpeed;
};
export type LocalOrder = "input" | "random";
export type LocalSetup = { ruleset: RulesetId; count: number; names: string[]; order: LocalOrder };

export const MAX_LOCAL_PLAYERS = 50;
export const DEFAULT_HUMAN_NAME = "나";
export const defaultLocalName = (index: number) => `플레이어 ${index + 1}`;
export const aiSpeedScale: Record<AiSpeed, number> = { slow: 1.5, normal: 1, fast: 0.5 };

export const defaultAiSetup: AiSetup = {
  ruleset: DEFAULT_RULESET,
  difficulty: "Greedy",
  name: DEFAULT_HUMAN_NAME,
  first: "me",
  research: false,
  researchAlgorithm: "DP Expert",
  speed: "normal",
};
export const defaultLocalSetup = (): LocalSetup => ({
  ruleset: DEFAULT_RULESET,
  count: 2,
  names: Array.from({ length: MAX_LOCAL_PLAYERS }, () => ""),
  order: "input",
});

const AI_KEY = "yachtlab.setup.ai.v1";
const LOCAL_KEY = "yachtlab.setup.local.v1";
const isDifficulty = (v: unknown): v is Algorithm => gameDifficulties.some((d) => d.algorithm === v);
const isAlgorithm = (v: unknown): v is Algorithm => (algorithms as readonly unknown[]).includes(v);
const pick = <T extends string>(v: unknown, options: readonly T[], fallback: T): T => (options.includes(v as T) ? (v as T) : fallback);

const stripControl = (text: string) =>
  [...text]
    .filter((ch) => {
      const c = ch.codePointAt(0)!;
      return !(c <= 0x1f || (c >= 0x7f && c <= 0x9f) || c === 0x2028 || c === 0x2029);
    })
    .join("");

/** Display names: NFC, no control characters, collapsed spaces, at most 24 characters. */
export function cleanName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return stripControl(raw.normalize("NFC")).replace(/\s+/g, " ").trim().slice(0, 24).trim();
}

/** Draft text while typing: control characters removed and length capped, spaces kept. */
export const draftName = (raw: unknown) => (typeof raw === "string" ? [...stripControl(raw)].slice(0, 24).join("") : "");

export function sanitizeAiSetup(raw: unknown): AiSetup {
  const v = typeof raw === "object" && raw ? (raw as Record<string, unknown>) : {};
  return {
    ruleset: isPlayableRuleset(v.ruleset) ? v.ruleset : DEFAULT_RULESET,
    difficulty: isDifficulty(v.difficulty) ? v.difficulty : defaultAiSetup.difficulty,
    name: typeof v.name === "string" ? draftName(v.name) : defaultAiSetup.name,
    first: pick(v.first, ["random", "me", "ai"] as const, defaultAiSetup.first),
    research: v.research === true,
    researchAlgorithm: isAlgorithm(v.researchAlgorithm) ? v.researchAlgorithm : defaultAiSetup.researchAlgorithm,
    speed: pick(v.speed, ["slow", "normal", "fast"] as const, defaultAiSetup.speed),
  };
}

export function sanitizeLocalSetup(raw: unknown): LocalSetup {
  const v = typeof raw === "object" && raw ? (raw as Record<string, unknown>) : {};
  const names = defaultLocalSetup().names.map((_, i) => (Array.isArray(v.names) ? draftName(v.names[i]) : ""));
  const count = Number.isInteger(v.count) ? Math.min(MAX_LOCAL_PLAYERS, Math.max(2, v.count as number)) : 2;
  return {
    ruleset: isPlayableRuleset(v.ruleset) ? v.ruleset : DEFAULT_RULESET,
    count,
    names,
    order: pick(v.order, ["input", "random"] as const, "input"),
  };
}

function read<T>(key: string, sanitize: (v: unknown) => T, fallback: () => T): T {
  try {
    const text = globalThis.localStorage?.getItem(key);
    return text ? sanitize(JSON.parse(text)) : fallback();
  } catch {
    return fallback();
  }
}
function write(key: string, value: unknown) {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value));
  } catch {
    // storage unavailable: keep in memory only
  }
}

let ai = read(AI_KEY, sanitizeAiSetup, () => ({ ...defaultAiSetup }));
let local = read(LOCAL_KEY, sanitizeLocalSetup, defaultLocalSetup);
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export const getAiSetup = () => ai;
export const getLocalSetup = () => local;
/** Draft edits are kept immediately (so "back" never loses input) and persisted. */
export function updateAiSetup(patch: Partial<AiSetup>) {
  ai = sanitizeAiSetup({ ...ai, ...patch });
  write(AI_KEY, ai);
  notify();
}
export function updateLocalSetup(patch: Partial<LocalSetup>) {
  local = sanitizeLocalSetup({ ...local, ...patch });
  write(LOCAL_KEY, local);
  notify();
}
export const useAiSetup = () => useSyncExternalStore(subscribe, getAiSetup, getAiSetup);
export const useLocalSetup = () => useSyncExternalStore(subscribe, getLocalSetup, getLocalSetup);

/* ------------------------------------------------------------- resolution ------------------------------------------------------------- */

const randomInt = (n: number) => crypto.getRandomValues(new Uint32Array(1))[0] % n;

export type AiMatchConfig = { algorithm: Algorithm; humanName: string; first: FirstPlayer; speed: AiSpeed };
export const aiMatchConfig = (setup: AiSetup): AiMatchConfig => ({
  algorithm: setup.research ? setup.researchAlgorithm : setup.difficulty,
  humanName: cleanName(setup.name) || DEFAULT_HUMAN_NAME,
  first: setup.first,
  speed: setup.speed,
});
/** Seat of the human player for one game (re-drawn on every rematch when "random"). */
export const resolveHumanSeat = (first: FirstPlayer, rand: (n: number) => number = randomInt): 0 | 1 =>
  first === "me" ? 0 : first === "ai" ? 1 : (rand(2) as 0 | 1);

/** Empty → default name, duplicates → " (2)", " (3)" suffix so every seat is distinguishable. */
export function finalizeNames(raw: readonly string[], count: number): string[] {
  const seen = new Map<string, number>();
  return Array.from({ length: count }, (_, i) => {
    const base = cleanName(raw[i]) || defaultLocalName(i);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base} (${n})`;
  });
}

/** Turn order for a local game: the input order, or a uniform shuffle (Fisher–Yates with CSPRNG). */
export function orderPlayers(names: readonly string[], order: LocalOrder, rand: (n: number) => number = randomInt): string[] {
  const list = [...names];
  if (order === "random")
    for (let i = list.length - 1; i > 0; i--) {
      const j = rand(i + 1);
      [list[i], list[j]] = [list[j], list[i]];
    }
  return list;
}
export const duplicateNames = (raw: readonly string[], count: number) => {
  const names = raw.slice(0, count).map((n, i) => cleanName(n) || defaultLocalName(i));
  return names.some((n, i) => names.indexOf(n) !== i);
};

import { ABUSE, AUDIT_CANDIDATES, BOOSTERS, POLICIES, SENSITIVITY, SINGLE, persona } from "../../../src/economy/v2/candidates";
import { baselineParams, type V2Params } from "../../../src/economy/v2/params";
import type { Persona, SimOptions } from "../../../src/economy/v2/sim";

export type AuditOptions = Pick<SimOptions, "proposedChat" | "initialCoins" | "initialGems" | "initialItems" | "suppressWelcome"> & { revision?: 1 | 2 };
export type Job = {
  t0?: number; exp: string; cell: string; params: V2Params; persona: Persona; users: number; seed: number;
  warmupDays: number; days: number; raw: boolean; tag: Record<string, string>; audit?: AuditOptions;
};
export const HOLDOUT = [328671901, 907063423, 1453908001, 2680638929];
export const FINALISTS = ["BASE", "V2-CONS", "V2-BAL", "V2-EXP", "C1-SAFE", "C1-PRICE", "C1-QUEST", "C1-LOOP", "C1-LONG", "C1-PRICE-R", "C1-COMBO"];
const DEV = 630736503;
const baseline = baselineParams();
const candidates = new Map([...SINGLE, ...POLICIES, ...AUDIT_CANDIDATES].map((p) => [p.id, p]));
const choose = (ids: string[]) => ids.map((id) => candidates.get(id)!);
const selected = choose(FINALISTS);
const cohorts = [
  { p: persona(30), age: 0, name: "new30" },
  { p: persona(60), age: 60, name: "existing60" },
  { p: persona(15, { activeProb: 0.65, weekendOnly: true, drawAppetite: 0.15 }), age: 30, name: "light15" },
  { p: persona(240, { activeProb: 0.8, drawAppetite: 0.15 }), age: 90, name: "heavy240" },
];
export function auditJobs(quick: boolean): Job[] {
  const jobs: Job[] = [];
  const add = (exp: string, c: V2Params, p: Persona, age: number, name: string, days: number, n: number, audit: AuditOptions = {}, seed = DEV) => {
    jobs.push({ exp, cell: `${c.id}|${name}|a${age}|r${audit.revision ?? 2}|s${seed}`, params: c, persona: p,
      users: quick ? Math.min(6, n) : n, seed, warmupDays: age, days, raw: false,
      tag: { scenario: name, age: String(age), revision: String(audit.revision ?? 2), chat: String(!!audit.proposedChat) }, audit });
  };
  // Search common/rare prices first, then compare package trade-offs at 30 days.
  for (const c of [baseline, ...AUDIT_CANDIDATES]) {
    for (const { p, age, name } of cohorts.slice(0, 2)) add("E8", c, p, age, name, 30, 48);
  }
  // Corrected putative E0: agree on the same budget but report the realized minutes and waits.
  for (const revision of [1, 2] as const) for (const age of [0, 60]) {
    for (const id of ["default", "len6", "len13", "len15", "aiHeavy", "offlineHeavy", "lowTraffic", "smallPool", "noQuest", "randomOnly"]) {
      const variant = SENSITIVITY.find((s) => s.id === id)!;
      const thursday = Date.UTC(2026, 11, 2, 15);
      add("E9", baseline, persona(240, { ...variant.patch, startHour: 19 }, `t240-${id}`), age, id, 1, 200, { revision });
      jobs.at(-1)!.t0 = thursday;
    }
  }
  // Calendar, preference, mode, balance and catalog scenarios.
  const variations: { name: string; p: Persona; age: number; audit?: AuditOptions }[] = [
    { name: "age7", p: persona(60), age: 7 },
    { name: "age30", p: persona(60), age: 30 },
    { name: "age180", p: persona(60), age: 180 },
    { name: "rich-owned", p: persona(60), age: 30, audit: { initialCoins: 4200, initialGems: 65, initialItems: { "dice.mint": 2, "dice.royal": 1, "board.ocean": 1, "chat.congrats": 1 } } },
    { name: "prefer-tier", p: persona(60, { preference: "tier" }), age: 60 },
    { name: "looks-save", p: persona(60, { spend: "saver", interest: "looks", drawAppetite: 0 }), age: 60 },
    { name: "upgrader", p: persona(60, { spend: "upgrader", interest: "looks", drawAppetite: 0 }), age: 60 },
    { name: "first-favorite", p: persona(30, { favorite: "first" }), age: 0 },
    { name: "social", p: persona(60, { interest: "social", drawAppetite: 0.1 }), age: 60 },
    { name: "draw", p: persona(60, { spend: "drawer" }), age: 60 },
    { name: "collection", p: persona(60, { spend: "collector", drawAppetite: 0 }), age: 60 },
    { name: "reserve", p: persona(60, { spend: "reserve", reserveCoins: 800, drawAppetite: 0 }), age: 60 },
    { name: "indifferent", p: persona(60, { spend: "indifferent" }), age: 60 },
    { name: "slow20", p: persona(60, { matchMinutes: { random: 20, ai: 16, friend: 20, solo: 8, offline: 12 } }), age: 60 },
    { name: "low-queue", p: persona(60, { queueSuccess: 0.35, queue: { meanWaitSec: 270, patienceSec: 180, fallback: "offline" } }), age: 60 },
    { name: "ai-room-cap", p: persona(60, { ...SENSITIVITY.find((x) => x.id === "aiHeavy")!.patch, aiClosesAt: 7 }), age: 60 },
    { name: "ai-open", p: persona(60, SENSITIVITY.find((x) => x.id === "aiHeavy")!.patch), age: 60 },
    { name: "offline-heavy", p: persona(60, SENSITIVITY.find((x) => x.id === "offlineHeavy")!.patch), age: 60 },
    { name: "small-pool", p: persona(60, SENSITIVITY.find((x) => x.id === "smallPool")!.patch), age: 60 },
    { name: "rev1", p: persona(60), age: 60, audit: { revision: 1 } },
    { name: "rev2", p: persona(60), age: 60 },
    { name: "chat-38", p: persona(60, { interest: "social", spend: "collector" }), age: 60, audit: { proposedChat: true } },
    { name: "chat-control", p: persona(60, { interest: "social", spend: "collector" }), age: 60 },
    { name: "chat-38-new", p: persona(60, { interest: "social", spend: "collector" }), age: 0, audit: { proposedChat: true } },
    { name: "chat-control-new", p: persona(60, { interest: "social", spend: "collector" }), age: 0 },
  ];
  for (const [i, v] of variations.entries()) {
    const ids = ["BASE", "C1-PRICE", i < 9 ? "C1-LOOP" : "C1-QUEST"];
    if (["rev1", "rev2", "chat-38", "chat-control"].includes(v.name)) ids.push("TIER1", "TIER2");
    for (const c of choose(ids)) add("E10", c, v.p, v.age, v.name, 90, 36, v.audit);
  }
  // The original E3 keeps all candidates; this block adds price-centered corrected alternatives.
  for (const b of [...BOOSTERS, {
    id: "discount", label: "할인권만", booster: { kind: "coupon" as const, freeDrawsPerDay: 0, discountPct: 30, discountPerWeek: 1 },
  }, {
    id: "free-draw", label: "무료 뽑기권만", booster: { kind: "coupon" as const, freeDrawsPerDay: 1, discountPct: 0, discountPerWeek: 0 },
  }]) {
    const c = { ...candidates.get("C1-PRICE")!, id: `C1-PRICE+${b.id}`, label: b.label, booster: b.booster };
    add("E11", c, persona(60), 60, "normal", 30, 60);
    add("E11", c, persona(30, { queueSuccess: 0.35, queue: { meanWaitSec: 300, patienceSec: 180, fallback: "offline" } }), 0, "low-traffic", 30, 60);
  }
  for (const c of choose(["BASE", "C1-PRICE", "C1-QUEST", "C1-LONG", "V2-EXP"])) {
    for (const p of [...ABUSE, persona(240, { ...ABUSE[1], modeMix: { random: 1 }, ownForfeit: 1 }, "forfeit-own"),
      persona(240, { ...ABUSE[1], modeMix: { random: 1 }, opponentPool: 1, oppForfeit: 1, ownForfeit: 0 }, "forfeit-opponent"),
      persona(240, { ...ABUSE[0], aiClosesAt: 5 }, "ai-cap-global")]) {
      add("E12", c, p, 7, p.id, 30, 24);
    }
    for (const suppressWelcome of [false, true]) add("E12", c, persona(30, { spend: "indifferent" }), 0, suppressWelcome ? "rejoin-cooled" : "new-distinct", 7, 60, { suppressWelcome });
  }
  for (const c of choose(["BASE", "C1-PRICE", "C1-LOOP", "C1-LONG", "V2-EXP"])) {
    add("E13", c, persona(60, { spend: "collector", drawAppetite: 0.15 }), 60, "collector180", 180, 54);
    add("E13", c, persona(60), 0, "new180", 180, 54);
  }
  for (const c of selected) for (const { p, age, name } of cohorts) for (const seed of HOLDOUT) {
    add("H1", c, p, age, name, 90, 48, {}, seed);
  }
  return jobs;
}

/**
 * Economy v2 research runner (C1, 2026-11-27) — `npx tsx scripts/economy/v2/run.ts [--quick]`.
 *
 * Runs every experiment of docs/economy/ECONOMY-V2-RESEARCH.md on worker threads and writes
 * aggregated results to docs/economy/v2/results/*.json and per-user raw rows to
 * docs/economy/v2/raw/*.csv.gz. Deterministic: seeds are fixed below (development seeds, not a holdout).
 */
import { Worker, isMainThread, parentPort } from "node:worker_threads";
import { availableParallelism, cpus } from "node:os";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { ABUSE, BOOSTERS, INTERACTION, MAIN_PERSONAS, POLICIES, POPULATION, SENSITIVITY, SINGLE, persona } from "../../../src/economy/v2/candidates";
import { baselineParams, PRICED_TIERS, type V2Params } from "../../../src/economy/v2/params";
import { auditJobs, type Job } from "./audit-plan";
import { survivalTimes } from "./survival";
import { simulateUser, type LegacyWarmups, type Persona, type UserResult } from "../../../src/economy/v2/sim";

const { values: options } = parseArgs({ options: {
  quick: { type: "boolean" },
  exp: { type: "string", multiple: true },
  candidate: { type: "string", multiple: true },
  seed: { type: "string" },
  workers: { type: "string" },
  out: { type: "string" },
  rev: { type: "string" },
} });
const QUICK = options.quick ?? false;
const OUT = new URL("../../../docs/economy/v2/", import.meta.url);
/** KST midnight of Monday 2026-11-30 (economy weeks start on Monday). */
const T0 = Date.UTC(2026, 10, 29, 15, 0, 0);
const SEED = 20261127;
const HORIZONS = [1, 7, 30, 90];
const AUDIT_HORIZONS = [...HORIZONS, 180];
const BASE = baselineParams();
const WARMUP = 60;

/* ------------------------------------------------------------- aggregation ------------------------------------------------------------- */
const q = (xs: number[], p: number) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const i = (s.length - 1) * p;
  const lo = Math.floor(i);
  return s[lo] + (s[Math.min(s.length - 1, lo + 1)] - s[lo]) * (i - lo);
};
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const se = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, xs.length - 1) / Math.max(1, xs.length));
};
/** Gini of non-negative values. */
export const gini = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  const tot = s.reduce((a, b) => a + b, 0);
  if (!n || tot === 0) return 0;
  let acc = 0;
  s.forEach((x, i) => (acc += (2 * (i + 1) - n - 1) * x));
  return acc / (n * tot);
};
/** Median with right-censoring (null = not reached = +∞) and a 95 % CI from binomial order statistics. */
function censoredMedian(xs: (number | null)[]) {
  const v = xs.map((x) => (x === null ? Infinity : x)).sort((a, b) => a - b);
  const n = v.length;
  const k = Math.floor(n / 2);
  const d = Math.ceil(1.96 * Math.sqrt(n) / 2);
  const f = (x: number) => (Number.isFinite(x) ? Math.round(x * 10) / 10 : null);
  return { median: f(v[k]), lo: f(v[Math.max(0, k - d)]), hi: f(v[Math.min(n - 1, k + d)]), reached: xs.filter((x) => x !== null).length / n };
}
const share = (xs: boolean[]) => {
  const p = xs.filter(Boolean).length / Math.max(1, xs.length);
  return { p: +p.toFixed(4), ci: +(1.96 * Math.sqrt((p * (1 - p)) / Math.max(1, xs.length))).toFixed(4) };
};
const stat = (xs: number[]) => ({ mean: +mean(xs).toFixed(1), se: +se(xs).toFixed(2), p10: +q(xs, 0.1).toFixed(1), p50: +q(xs, 0.5).toFixed(1), p90: +q(xs, 0.9).toFixed(1) });

function aggregate(rs: UserResult[]) {
  const out: Record<string, unknown> = { n: rs.length };
  out.firstObtainMin = censoredMedian(rs.map((r) => r.firstObtainMin));
  out.firstBuyMin = censoredMedian(rs.map((r) => r.firstBuyMin));
  out.firstLv3Min = censoredMedian(rs.map((r) => r.firstLv3Min));
  out.firstLv3Day = censoredMedian(rs.map((r) => r.firstLv3Day));
  out.firstTierMin = Object.fromEntries(PRICED_TIERS.map((t) => [t, censoredMedian(rs.map((r) => r.firstTierMin[t]))]));
  out.firstTierDay = Object.fromEntries(PRICED_TIERS.map((t) => [t, censoredMedian(rs.map((r) => r.firstTierDay[t]))]));
  out.maxCoinsDay = stat(rs.map((r) => r.maxCoinsDay));
  const hs: Record<string, unknown> = {};
  for (const s0 of rs[0]?.snapshots ?? []) {
    const h = s0.day;
    const ss = rs.map((r) => r.snapshots.find((s) => s.day === h)!);
    const sources = [...new Set(ss.flatMap((s) => Object.keys(s.bySource)))];
    hs[h] = {
      minutes: stat(ss.map((s) => s.minutes)),
      matches: stat(ss.map((s) => s.matches)),
      paidMatches: stat(ss.map((s) => s.paidMatches)),
      coinsEarned: stat(ss.map((s) => s.coinsEarned)),
      coinsPerHour: stat(ss.map((s) => (s.minutes > 0 ? (s.coinsEarned * 60) / s.minutes : 0))),
      gemsEarned: stat(ss.map((s) => s.gemsEarned)),
      coins: stat(ss.map((s) => s.coins)),
      gems: stat(ss.map((s) => s.gems)),
      owned: stat(ss.map((s) => s.owned)),
      ownedValue: stat(ss.map((s) => s.ownedValue)),
      lv3: stat(ss.map((s) => s.lv3)),
      collectionsComplete: stat(ss.map((s) => s.collectionsComplete)),
      synergyReady: stat(ss.map((s) => s.synergyReady)),
      affordableUnowned: stat(ss.map((s) => s.affordableUnowned)),
      cheapestUnowned: stat(ss.map((s) => s.cheapestUnowned ?? 0)),
      wishLeft: stat(ss.map((s) => s.wishLeft)),
      bySource: Object.fromEntries(sources.map((k) => [k, +mean(ss.map((s) => s.bySource[k] ?? 0)).toFixed(1)])),
      spent: { item: +mean(ss.map((s) => s.spent.item)).toFixed(1), upgrade: +mean(ss.map((s) => s.spent.upgrade)).toFixed(1), draw: +mean(ss.map((s) => s.spent.draw)).toFixed(1), gemsItem: +mean(ss.map((s) => s.spent.gemsItem)).toFixed(1) },
      reducedDayShare: +mean(ss.map((s) => (s.activeDays ? s.daysReduced / s.activeDays : 0))).toFixed(4),
      cappedDayShare: +mean(ss.map((s) => (s.activeDays ? s.daysCapped / s.activeDays : 0))).toFixed(4),
      everCapped: share(ss.map((s) => s.daysCapped > 0)),
      boostCoins: stat(ss.map((s) => s.boostCoins)),
      boosterWasteShare: +mean(ss.map((s) => (s.boosterMinutesGranted ? 1 - s.boosterMinutesUsed / s.boosterMinutesGranted : 0))).toFixed(4),
      draws: stat(ss.map((s) => s.draws)),
      duplicateShare: +(ss.reduce((a, s) => a + s.duplicates, 0) / Math.max(1, ss.reduce((a, s) => a + s.draws, 0))).toFixed(4),
      giniEarned: +gini(ss.map((s) => s.coinsEarned)).toFixed(4),
      obtainedBy: share(rs.map((r) => r.firstObtainDay !== null && r.firstObtainDay < h)),
      boughtBy: share(rs.map((r) => r.firstBuyDay !== null && r.firstBuyDay < h)),
      lv3By: share(rs.map((r) => r.firstLv3Day !== null && r.firstLv3Day < h)),
      tierBy: Object.fromEntries(PRICED_TIERS.map((t) => [t, share(rs.map((r) => r.firstTierDay[t] !== null && r.firstTierDay[t]! < h))])),
    };
    if (s0.audit) {
      const samples = ss.map((s) => s.audit!);
      const fields = ["ownedValueFixed", "buyable", "affordableWithGems", "netCoins", "netGems", "aiDenied", "waitMin",
        "boostedSessions", "boosterSessions", "potentialAiStarts", "eligibleAiStarts", "purchases"] as const;
      const keyStats = (key: "modes" | "grantsByGems" | "forbids" | "ownedByTier") =>
        Object.fromEntries([...new Set(samples.flatMap((x) => Object.keys(x[key])))].sort()
          .map((k) => [k, stat(samples.map((x) => (x[key] as Record<string, number>)[k] ?? 0))]));
      const elapsed = (f: (a: typeof samples[number], r: UserResult) => number | null) =>
        survivalTimes(samples.map((a, i) => ({ event: f(a, rs[i]), censor: ss[i].minutes })));
      const reach = (f: (a: typeof samples[number]) => number | null) => share(samples.map((x) => f(x) !== null && f(x)! < h));
      const maxGap = (days: number[]) => {
        const events = [0, ...days.filter((d) => d < h), h];
        return Math.max(...events.slice(1).map((d, i) => d - events[i]));
      };
      Object.assign(hs[h] as object, {
        audit: {
          ...Object.fromEntries(fields.map((k) => [k, stat(samples.map((a) => a[k]))])),
          modes: keyStats("modes"), grantsByGems: keyStats("grantsByGems"), forbids: keyStats("forbids"), ownedByTier: keyStats("ownedByTier"),
          firstDirect: elapsed((_, r) => r.firstBuyDay === null || r.firstBuyDay >= h ? null : r.firstBuyMin),
          firstAny: elapsed((_, r) => r.firstObtainDay === null || r.firstObtainDay >= h ? null : r.firstObtainMin),
          secondDirect: elapsed((a) => a.purchaseDays[1] < h ? a.purchaseTimes[1] : null),
          desired: elapsed((a) => a.desiredDay !== null && a.desiredDay < h ? a.desiredTime : null),
          noBuy: share(samples.map((x) => !x.purchaseDays.some((d) => d < h))),
          maxGapDays: stat(samples.map((x) => maxGap(x.purchaseDays))),
          gap30: share(samples.map((x) => maxGap(x.purchaseDays) >= 30)),
          intervalAfterFirst: stat(samples.flatMap((a) => a.purchaseDays[1] < h ? [a.purchaseTimes[1] - a.purchaseTimes[0]] : [])),
          lv2By: reach((a) => a.firstLevel2Day),
          lv3By: share(rs.map((r) => r.firstLv3Day !== null && r.firstLv3Day < h)),
          desiredBy: reach((a) => a.desiredDay),
        },
      });
    }
  }
  out.h = hs;
  return out;
}
function rawRows(job: Job, rs: UserResult[]) {
  return rs.map((r, i) => {
    const s = r.snapshots[r.snapshots.length - 1];
    return [job.exp, job.cell, job.params.id, job.persona.id, job.warmupDays ? "existing" : "new", job.seed, i, r.firstObtainMin?.toFixed(1) ?? "", r.firstBuyMin?.toFixed(1) ?? "", ...PRICED_TIERS.map((t) => r.firstTierDay[t] ?? ""), r.firstLv3Day ?? "", r.maxCoinsDay, s.day, s.minutes.toFixed(0), s.matches, s.paidMatches, s.coinsEarned, s.gemsEarned, s.coins, s.gems, s.owned, s.ownedValue, s.lv3, s.collectionsComplete, s.spent.item, s.spent.upgrade, s.spent.draw, s.boostCoins, s.draws, s.duplicates].join(",");
  });
}
const RAW_HEADER = "exp,cell,candidate,persona,user,seed,idx,firstObtainMin,firstBuyMin,commonDay,rareDay,epicDay,legendaryDay,mythicDay,lv3Day,maxCoinsDay,day,minutes,matches,paidMatches,coinsEarned,gemsEarned,coins,gems,owned,ownedValue,lv3,collectionsComplete,spentItem,spentUpgrade,spentDraw,boostCoins,draws,duplicates";

const legacyWarmups = new Map<string, LegacyWarmups>();

function runJob(job: Job) {
  const rs: UserResult[] = [];
  const horizons = job.audit ? AUDIT_HORIZONS : HORIZONS;
  const opts = { days: job.days, warmupDays: job.warmupDays, warmupParams: BASE,
    snapshots: horizons.filter((h) => h <= job.days),
    includeRev2: job.audit?.revision ? job.audit.revision === 2 : options.rev !== "1",
    t0: job.t0 ?? T0, ...job.audit, audited: !!job.audit };
  const warmKey = JSON.stringify([job.persona, job.seed, opts.t0, opts.warmupDays, opts.includeRev2]);
  let warmups: LegacyWarmups | undefined;
  if (!job.audit && job.warmupDays) {
    warmups = legacyWarmups.get(warmKey);
    if (!warmups) legacyWarmups.set(warmKey, warmups = []);
  }
  for (let i = 0; i < job.users; i++) rs.push(simulateUser(job.persona, job.params, job.seed, i, opts, warmups));
  const sample = (r: UserResult) => {
    const end = r.snapshots.at(-1)!;
    const d30 = r.snapshots.find((s) => s.day === 30) ?? end;
    return {
      direct: r.firstBuyMin, any: r.firstObtainMin, censor: end.minutes,
      coin: end.coinsEarned, net: end.audit!.netCoins, balance: end.coins,
      desired30: d30.audit!.desiredDay !== null && d30.audit!.desiredDay < 30,
      buy7: r.firstBuyDay !== null && r.firstBuyDay < 7,
      any7: r.firstObtainDay !== null && r.firstObtainDay < 7,
      buy30: r.firstBuyDay !== null && r.firstBuyDay < 30,
      lv3: r.firstLv3Day !== null && r.firstLv3Day < 90, owned: end.owned,
      lateGap30: (end.audit!.purchaseDays.filter((d) => d < end.day).at(-1) ?? 0) <= end.day - 30,
      fixedValue: end.audit!.ownedValueFixed,
    };
  };
  return { agg: aggregate(rs), raw: job.raw ? rawRows(job, rs) : [],
    earned: rs.map((r) => r.snapshots.at(-1)!.coinsEarned), firstObtain: rs.map((r) => r.firstObtainMin),
    samples: job.exp === "H1" ? rs.map(sample) : [] };
}

/* ------------------------------------------------------------- experiments ------------------------------------------------------------- */
function jobs(): Job[] {
  const N = QUICK ? 20 : 200;
  const n2 = QUICK ? 15 : 150;
  const list: Job[] = [];
  const add = (exp: string, params: V2Params, p: Persona, users: number, warm: boolean, extra: Partial<Job> = {}) =>
    list.push({ exp, cell: `${params.id}|${p.id}|${warm ? "existing" : "new"}`, params, persona: p, users, seed: SEED, warmupDays: warm ? WARMUP : 0, days: 90, raw: false, tag: {}, ...extra });
  // E0 — one 4-hour day: cause decomposition of the field feedback
  const fourH = [
    { id: "default", label: "기본 혼합(빠른 50·친구 10·서버 AI 25·오프라인 15%)" },
    ...SENSITIVITY.filter((s) => ["randomOnly", "len15", "aiHeavy", "offlineHeavy", "lowTraffic", "smallPool", "noQuest", "wr35"].includes(s.id)),
  ];
  for (const s of fourH) {
    const patch = SENSITIVITY.find((x) => x.id === s.id)?.patch ?? {};
    for (const warm of [false, true]) add("E0", baselineParams(), persona(240, { ...patch, startHour: 19 }, `t240-${s.id}`), QUICK ? 40 : 1000, warm, { days: 1, t0: T0 + 3 * 86_400_000, tag: { scenario: s.id } }); // a Thursday
  }
  // E1 — main grid: single factors + policies × play time × new/existing
  for (const c of [...SINGLE, ...POLICIES]) for (const p of MAIN_PERSONAS) for (const warm of [false, true]) add("E1", c, p, N, warm, { raw: true });
  // E2 — interaction grid (match × price)
  for (const c of INTERACTION) for (const p of MAIN_PERSONAS.filter((x) => [60, 240].includes(x.minutesPerDay))) for (const warm of [false, true]) add("E2", c, p, n2, warm);
  // E3 — boosters on the baseline and on the balanced policy
  const bal = POLICIES.find((x) => x.id === "V2-BAL")!;
  for (const base of [baselineParams(), bal])
    for (const b of BOOSTERS) {
      const c = { ...base, id: `${base.id}+${b.id}`, label: `${base.label} + ${b.label}`, booster: b.booster };
      for (const p of MAIN_PERSONAS) add("E3", c, p, n2, true);
      for (const p of MAIN_PERSONAS.filter((x) => [30, 240].includes(x.minutesPerDay))) add("E3", c, p, n2, false);
    }
  // E4 — sensitivity of the key candidates
  for (const c of [baselineParams(), ...POLICIES])
    for (const s of SENSITIVITY) for (const m of [60, 240]) for (const warm of [false, true]) add("E4", c, persona(m, s.patch, `t${m}-${s.id}`), n2, warm, { tag: { sens: s.id } });
  // E5 — abuse personas (30 days)
  for (const c of [baselineParams(), ...POLICIES, { ...baselineParams(), id: "BASE+time60x2", booster: BOOSTERS.find((b) => b.id === "time60x2")!.booster }, { ...bal, id: "V2-BAL+auto3x2", booster: BOOSTERS.find((b) => b.id === "auto3x2")!.booster }])
    for (const p of ABUSE) add("E5", c, p, QUICK ? 5 : 30, true, { days: 30 });
  // E6 — population (concentration / inequality), 90 days, new + existing mix
  for (const c of [baselineParams(), ...POLICIES])
    for (const pop of POPULATION) for (const warm of [false, true]) add("E6", c, persona(pop.minutes, { activeProb: pop.activeProb }, `pop${pop.minutes}`), Math.round((QUICK ? 100 : 2000) * pop.share), warm, { tag: { share: String(pop.share) } });
  // E7 — seed stability: independent seed block for the baseline and the policies
  for (const c of [baselineParams(), ...POLICIES]) for (const p of MAIN_PERSONAS.filter((x) => [30, 240].includes(x.minutesPerDay))) for (const warm of [false, true]) add("E7", c, p, N, warm, { seed: SEED + 1 });
  return list;
}

function groupsSeedNote(all: Job[]) {
  return all.some((job) => job.exp === "H1")
    ? "H1 uses the four pre-registered holdout seeds; see the per-cell settings"
    : "Development experiments; see the per-cell settings";
}

/* --------------------------------------------------------------- driver --------------------------------------------------------------- */
if (!isMainThread) {
  parentPort!.on("message", (job: Job) => parentPort!.postMessage({ cell: job.cell, exp: job.exp, ...runJob(job) }));
} else {
  const seed = options.seed === undefined ? undefined : Number(options.seed);
  if (seed !== undefined && (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff - 1)) throw new Error("Invalid --seed");
  if (options.rev && !["1", "2"].includes(options.rev)) throw new Error("Invalid --rev");
  const requestedWorkers = Number(options.workers ?? Math.min(4, availableParallelism()));
  if (!Number.isInteger(requestedWorkers) || requestedWorkers < 1 || requestedWorkers > availableParallelism()) {
    throw new Error(`--workers must be between 1 and ${availableParallelism()}`);
  }
  const audit = options.exp?.some((exp) => exp === "H1" || /^E(?:[89]|1[0-3])$/.test(exp));
  if (options.exp?.includes("H1") && seed !== undefined) throw new Error("H1 seeds are pre-specified");
  const all = (audit ? [...jobs(), ...auditJobs(QUICK)] : jobs())
    .filter((job) => (!options.exp || options.exp.includes(job.exp)) && (!options.candidate || options.candidate.includes(job.params.id)))
    .map((job) => seed === undefined ? job : { ...job, seed: seed + (job.exp === "E7" ? 1 : 0) });
  if (!all.length) throw new Error("No matching jobs");
  const sha = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
  const root = new URL("../../../", import.meta.url);
  const codePaths = ["src", "scripts/economy/v2"].flatMap((dir) =>
    readdirSync(new URL(dir + "/", root), { recursive: true, encoding: "utf8" })
      .filter((file) => /\.(ts|json)$/.test(file)).map((file) => dir + "/" + file),
  ).sort();
  const codeHash = sha(JSON.stringify(codePaths.map((p) => [p, sha(readFileSync(new URL(p, root)))])));
  const settingsHash = sha(JSON.stringify({ all, T0, HORIZONS, rev: options.rev ?? "2" }));
  const dir = resolve(options.out ?? fileURLToPath(new URL(QUICK ? "results-quick/" : "replay/", OUT)));
  const cacheDir = resolve(dir, ".jobs", codeHash + "-" + process.version + "-rev" + (options.rev ?? "2"));
  mkdirSync(cacheDir, { recursive: true });
  const atomic = (path: string, data: string | Buffer) => {
    const temp = path + "." + process.pid + ".tmp";
    writeFileSync(temp, data);
    renameSync(temp, path);
  };
  type Result = ReturnType<typeof runJob>;
  const outputs = new Map<Job, Result>();
  const checkpoint = (job: Job) => resolve(cacheDir, sha(JSON.stringify(job)) + ".json");
  const started = performance.now();
  const cost = (j: Job) => j.users * (j.warmupDays + j.days) * Math.max(1, j.persona.minutesPerDay / 60);
  const order = all.filter((job) => {
    const path = checkpoint(job);
    if (!existsSync(path)) return true;
    outputs.set(job, JSON.parse(readFileSync(path, "utf8")) as Result);
    return false;
  }).sort((a, b) => {
    const phases = ["E0", "E7", "E2", "E3", "E5", "E6", "E4", "E1"];
    const stage = (job: Job) => phases.indexOf(job.exp);
    return stage(a) - stage(b) || cost(b) - cost(a);
  });
  const threads = Math.min(order.length, requestedWorkers);
  const runSeeds = [...new Set(all.map((j) => j.seed))].sort((a, b) => a - b);
  const meta = { generatedBy: "scripts/economy/v2/run.ts", config: "M3i-W30@2 baseline (src/economy/live/config.ts)", codeHash, settingsHash, seed: runSeeds.length === 1 ? runSeeds[0] : null, seeds: runSeeds, seedNote: groupsSeedNote(all), rev: Number(options.rev ?? 2), t0: new Date(T0).toISOString(), horizons: HORIZONS, warmupDays: WARMUP, jobs: all.length, players: all.reduce((a, j) => a + j.users, 0), node: process.version, quick: QUICK };
  const groups = Map.groupBy(all, (j) => j.exp);
  function writeGroup(exp: string) {
    const batch = groups.get(exp)!;
    if (batch.some((j) => !outputs.has(j))) return;
    const cells = Object.fromEntries([...batch].sort((a, b) => a.cell.localeCompare(b.cell)).map((job) => {
      const m = outputs.get(job)!;
      return [job.cell, { candidate: job.params.id, label: job.params.label, group: job.params.group, persona: job.persona.id,
        minutesPerDay: job.persona.minutesPerDay, user: job.warmupDays ? "existing" : "new", seed: job.seed, ...job.tag, ...m.agg }];
    }));
    atomic(resolve(dir, exp + ".json"), JSON.stringify({ meta, cells }));
  }
  // A fully completed experiment is readable even if a later job fails.
  for (const exp of groups.keys()) writeGroup(exp);
  const left = new Map([...groups].map(([exp, batch]) => [exp, batch.filter((j) => !outputs.has(j)).length]));
  let next = 0;
  let done = outputs.size;
  console.log(`economy-v2: ${all.length} jobs, ${done} resumed, ${threads} workers`);
  const pool: Worker[] = [];
  const file = fileURLToPath(import.meta.url);
  try {
    await Promise.all(Array.from({ length: threads }, () => new Promise<void>((resolve, reject) => {
      const w = new Worker(file, { execArgv: ["--import", "tsx"] });
      pool.push(w);
      let job: Job | undefined;
      const feed = () => {
        job = order[next++];
        if (!job) return resolve();
        w.postMessage(job);
      };
      const fail = (error: unknown) => reject(new Error(`${job?.exp ?? "worker"} ${job?.cell ?? ""}`, { cause: error }));
      w.on("error", fail);
      w.on("exit", (code) => { if (job) fail(new Error(`worker exited (${code})`)); });
      w.on("message", (m: Result & { cell: string; exp: string }) => {
        try {
          if (!job || m.exp !== job.exp || m.cell !== job.cell) throw new Error("Unexpected worker result");
          const { agg, raw, earned, firstObtain } = m;
          const output = { agg, raw, earned, firstObtain, samples: m.samples };
          atomic(checkpoint(job), JSON.stringify(output));
          outputs.set(job, output);
          const remaining = (left.get(job.exp) ?? 0) - 1;
          left.set(job.exp, remaining);
          if (remaining === 0) {
            writeGroup(job.exp);
            console.log(`  ${job.exp} complete`);
          }
          if (++done % 50 === 0 || done === all.length) console.log(`  ${done}/${all.length} (${((performance.now() - started) / 1000).toFixed(0)} s)`);
          feed();
        } catch (e) { fail(e); }
      });
      feed();
    })));
  } finally {
    await Promise.all(pool.map((worker) => worker.terminate()));
  }
  const seconds = (performance.now() - started) / 1000;
  const raw: string[] = [];
  const pops: Record<string, { earned: number[]; firstObtain: (number | null)[] }> = {};
  for (const job of [...all].sort((a, b) => a.exp.localeCompare(b.exp) || a.cell.localeCompare(b.cell))) {
    const m = outputs.get(job)!;
    raw.push(...m.raw);
    if (job.exp === "E6") {
      const key = `${job.params.id}|${job.warmupDays ? "existing" : "new"}`;
      const pp = (pops[key] ??= { earned: [], firstObtain: [] });
      pp.earned.push(...m.earned);
      pp.firstObtain.push(...m.firstObtain);
    }
  }
  const popSummary = Object.fromEntries(Object.entries(pops).map(([k, v]) => {
    const s = [...v.earned].sort((a, b) => b - a);
    const tot = s.reduce((a, b) => a + b, 0);
    return [k, { n: s.length, gini: +gini(v.earned).toFixed(4), top10Share: +(s.slice(0, Math.ceil(s.length / 10)).reduce((a, b) => a + b, 0) / Math.max(1, tot)).toFixed(4), bottom50Share: +(s.slice(Math.floor(s.length / 2)).reduce((a, b) => a + b, 0) / Math.max(1, tot)).toFixed(4), p90p10: +(q(v.earned, 0.9) / Math.max(1, q(v.earned, 0.1))).toFixed(2), meanEarned90: +mean(v.earned).toFixed(0) }];
  }));
  if (groups.has("E6")) atomic(resolve(dir, "population.json"), JSON.stringify({ meta, populations: popSummary }, null, 1));
  const sampled = [...outputs].filter(([, m]) => m.samples.length).sort(([a], [b]) => a.cell.localeCompare(b.cell));
  if (sampled.length) atomic(resolve(dir, "H1-samples.json.gz"), gzipSync(JSON.stringify(Object.fromEntries(sampled.map(([j, m]) => [j.cell, m.samples])))));
  if (audit) {
    const configuration = [...all].sort((a, b) => a.exp.localeCompare(b.exp) || a.cell.localeCompare(b.cell))
      .map((j) => ({ exp: j.exp, cell: j.cell, settings: j.params, cohort: j.persona, audit: j.audit, seed: j.seed, days: j.days, users: j.users, warmupDays: j.warmupDays, t0: j.t0 ?? T0 }));
    atomic(resolve(dir, "job-settings.json.gz"), gzipSync(JSON.stringify(configuration)));
  }
  if (raw.length) atomic(resolve(dir, "E1-users.csv.gz"), gzipSync([RAW_HEADER, ...raw].join("\n")));
  atomic(resolve(dir, "meta.json"), JSON.stringify(meta, null, 1));
  console.log(`done in ${seconds.toFixed(1)} s → ${dir}`);
}

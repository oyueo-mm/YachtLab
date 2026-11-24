/**
 * Economy study — follow-up verification of M3 (2026-11-24, second request).
 *
 *   npx tsx scripts/economy/run-followup.ts [usersPerCohort=200] [--quick]
 *
 * Integer operating model (completion = 10 coins), win-bonus variants, matches per active day, match
 * duration, recurring vs one-time income by year, long-term gem purchasing power, new/continuing/churned
 * users, multiple seeds, no-event economy, guest carry-over candidates, quest completion matches,
 * upgrade ratios, gem-bought upgrade currency, symbolic prices, Cloudflare free-plan capacity.
 * Outputs: docs/economy/results/followup.json, src/economy/data/lab-followup.json.
 * All user-behaviour numbers are assumptions (no real user data).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { ACHIEVEMENTS, QUESTS, TIER_IDS, eventProbability, achievementGems, type TierId, type EventKey } from "../../src/economy/content";
import { integerM3, MODELS, scaleCoins, type EconomyModel } from "../../src/economy/models";
import { PERSONAS, ABUSE_VARIANTS, personaById, type Persona } from "../../src/economy/personas";
import { DEFAULT_CATALOG, DEFAULT_CURRENCY_MIX, RARITIES, RARITY_LABEL, STEP_RATIOS, TARGET_DAYS, ITEM_TYPE_LABEL, buildCatalog, derivePrices, deriveSlots, niceRound, upgradeCosts, type PriceTable, type UpgradeConfig } from "../../src/economy/pricing";
import { DEFAULT_WIN_RATE, ONE_TIME_SOURCES, RECURRING_SOURCES, SOURCES, simulateCohort, simulatePopulation, simulateUser, type SimContext, type UserResult } from "../../src/economy/simulate";
import { FREE_LIMITS } from "../../src/economy/cloudflare";
import { mulberry32, summary, type Rng } from "../../src/economy/rng";

const QUICK = process.argv.includes("--quick");
const N = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? (QUICK ? 40 : 200));
const SEED = 20261125;
const SEEDS = [20261125, 11, 22, 33, 44];
const t0 = performance.now();
const log = (...a: unknown[]) => console.log(`[${((performance.now() - t0) / 1000).toFixed(0)}s]`, ...a);
const r4 = (x: number) => (Number.isFinite(x) ? Number(x.toPrecision(4)) : x);
const round = (o: unknown): unknown => JSON.parse(JSON.stringify(o, (_k, v) => (typeof v === "number" && !Number.isInteger(v) ? r4(v) : v)));
const OUT: Record<string, unknown> = {};
const Y5 = QUICK ? 730 : 1825;
const ACH_GEMS = Object.fromEntries(ACHIEVEMENTS.map((a) => {
  // same reward rule as phase 1 (1.5·√E for the 중급 reference tier, cap 100)
  const p = a.key === "match" || a.key === "win" ? (a.key === "win" ? 0.5 : 1) : null;
  let E: number;
  if (a.key === "streak") E = 2 ** (a.count + 1) - 2;
  else if (a.key === "activeDays") E = a.count * 6;
  else if (a.key === "dailyQuests") E = (a.count * 7.5) / 0.6;
  else if (a.key === "yachtFaces") E = 90;
  else E = a.count / (p ?? Math.max(1e-30, eventProbability("intermediate", a.key as EventKey)));
  return [a.id, achievementGems(E)];
}));
const BASE = integerM3(0.67);
const F2P = <T extends Persona>(p: T): T => ({ ...p, payer: null });
const regular = personaById("regular");

// ---------- prices for the integer model (derived from its own reference income) ----------
const dummy: PriceTable = { coin: [1, 1, 1, 1, 1], gem: [1, 1, 1, 1, 1], currencyMix: DEFAULT_CURRENCY_MIX };
function ctxFor(model: EconomyModel, prices: PriceTable, extra: Partial<SimContext> = {}, gemValue = 30, catalogSeed = SEED): SimContext {
  return {
    model, catalog: buildCatalog(DEFAULT_CATALOG, prices, Y5 + 1, catalogSeed), upgrade: { curve: "exponential", baseFraction: 0.5, maxLevel: 3, param: 3, steps: [0.5, 1.5] },
    slots: deriveSlots(150, 4.5), gemValueInCoins: gemValue, winRate: DEFAULT_WIN_RATE, achievementGems: ACH_GEMS, spending: true, ...extra,
  };
}
const freeCoins = (u: UserResult) => SOURCES.reduce((a, s) => a + (s === "purchase" ? 0 : u.coinsBySource[s]), 0);
const freeGems = (u: UserResult) => SOURCES.reduce((a, s) => a + (s === "purchase" ? 0 : u.gemsBySource[s]), 0);
const ref = simulateCohort(ctxFor(BASE, dummy, { spending: false, forceF2P: true, forceLoggedIn: true }), regular, N, 365, SEED);
const REF_COINS = summary(ref.map((u) => freeCoins(u) / 365)).median;
const REF_GEMS = summary(ref.map((u) => freeGems(u) / 365)).median;
const GEM_VALUE = REF_COINS / REF_GEMS;
const PRICES = derivePrices(REF_COINS, REF_GEMS);
const SLOTS = deriveSlots(REF_COINS, REF_GEMS);
const ctx = (model: EconomyModel = BASE, extra: Partial<SimContext> = {}, catalogSeed = SEED) => ({ ...ctxFor(model, PRICES, extra, GEM_VALUE, catalogSeed), slots: SLOTS });
log("integer reference", { REF_COINS, REF_GEMS, GEM_VALUE, PRICES });
OUT.integer = { model: BASE, refCoinsPerDay: REF_COINS, refGemsPerDay: REF_GEMS, gemValue: GEM_VALUE, prices: PRICES, slots: SLOTS, achievementGems: ACH_GEMS };

const reach = (us: UserResult[], k: number, H: number) => us.filter((u) => u.loggedIn && u.firstRarityDay[k] >= 0 && u.firstRarityDay[k] < H).length / Math.max(1, us.filter((u) => u.loggedIn).length);
const medDay = (vals: number[], H: number) => summary(vals.map((d) => (d >= 0 && d < H ? d + 1 : H + 1))).median;

// ---------- F1: integer model re-validation vs phase-1 normalized M3 ----------
{
  const rows = [];
  for (const pid of ["occasional", "light", "regular", "heavy", "extreme", "saver"]) {
    const us = simulateCohort(ctx(BASE, { forceF2P: true }), personaById(pid), N, Y5, SEED, [365]);
    const li = us.filter((u) => u.loggedIn);
    rows.push({ persona: pid, coinsPerDay1y: summary(li.map((u) => u.checkpoints[365].earnedCoins / 365)), gemsPerDay1y: summary(li.map((u) => u.checkpoints[365].earnedGems / 365)), mythic1y: reach(us, 4, 365), mythic3y: reach(us, 4, 1095), mythic5y: reach(us, 4, Y5), legendary1y: reach(us, 3, 365), mythicMax5y: li.filter((u) => u.firstMythicMaxDay >= 0).length / Math.max(1, li.length) });
  }
  const bot = simulateCohort(ctx(BASE, { spending: false, forceLoggedIn: true }), personaById("abuser"), 20, 30, SEED);
  const heavy = simulateCohort(ctx(BASE, { spending: false, forceLoggedIn: true, forceF2P: true }), personaById("heavy"), 60, 30, SEED);
  OUT.F1 = { rows, botRatio30d: summary(bot.map(freeCoins)).median / summary(heavy.map(freeCoins)).median };
  log("F1");
}

// ---------- F2: matches per active day ----------
{
  const rows = [];
  for (const n of [1, 3, 6, 10, 15, 40]) {
    const p: Persona = { ...regular, id: `apd${n}`, matchesMean: n, matchesShape: 1000, questChaser: false, payer: null };
    const us = simulateCohort(ctx(BASE, { forceLoggedIn: true, forceF2P: true }), p, N, 365, SEED, [365]);
    const ad = summary(us.map((u) => freeCoins(u) / Math.max(1, u.activeDays))).median;
    const matches = summary(us.map((u) => u.matches)).median;
    rows.push({ matchesPerActiveDay: n, coinsPerActiveDay: ad, coinsPerMatch: summary(us.map((u) => freeCoins(u) / Math.max(1, u.matches))).median, coinsPerHour7min: (ad / (n * 7)) * 60, gemsPerActiveDay: summary(us.map((u) => freeGems(u) / Math.max(1, u.activeDays))).median, dailyQuestAllShare: summary(us.map((u) => u.dailyQuestsDone / Math.max(1, u.activeDays))).median, coinsPerDay: summary(us.map((u) => freeCoins(u) / 365)).median, matchesPerYear: matches, mythic1y: reach(us, 4, 365), mythicDay: medDay(us.map((u) => u.firstRarityDay[4]), 365) });
  }
  OUT.F2 = rows;
  log("F2");
}

// ---------- F3: match duration (fixed daily play time) ----------
{
  const rows = [];
  for (const D of [7, 10, 14, 20]) for (const pid of ["regular", "heavy"]) {
    const base = personaById(pid);
    const p: Persona = { ...base, id: `${pid}-d${D}`, minutesPerMatch: D, matchesMean: (base.matchesMean * 7) / D, payer: null };
    const us = simulateCohort(ctx(BASE, { forceLoggedIn: true, forceF2P: true }), p, N, 365, SEED, [365]);
    const cpd = summary(us.map((u) => freeCoins(u) / 365)).median;
    const hours = summary(us.map((u) => (u.matches * D) / 60 / 365)).median;
    rows.push({ minutes: D, persona: pid, matchesPerActiveDay: p.matchesMean, coinsPerDay: cpd, coinsPerHour: cpd / Math.max(1e-9, hours), gemsPerDay: summary(us.map((u) => freeGems(u) / 365)).median, mythic1y: reach(us, 4, 365) });
  }
  OUT.F3 = rows;
  log("F3");
}

// ---------- F4/F5: recurring vs one-time by year, long-term gems ----------
const yearly: Record<string, unknown> = {};
const longTerm: Record<string, unknown> = {};
for (const pid of ["light", "regular", "heavy", "extreme"]) {
  const us = simulateCohort(ctx(BASE, { forceLoggedIn: true, forceF2P: true }), personaById(pid), N, Y5, SEED);
  const yrs = [0, 2, 4].filter((y) => (y + 1) * 365 <= Y5);
  yearly[pid] = yrs.map((y) => ({
    year: y + 1,
    recurringCoins: summary(us.map((u) => RECURRING_SOURCES.reduce((a, s) => a + u.coinsYear[s][y], 0))).median,
    oneTimeCoins: summary(us.map((u) => ONE_TIME_SOURCES.reduce((a, s) => a + u.coinsYear[s][y], 0))).median,
    recurringGems: summary(us.map((u) => RECURRING_SOURCES.reduce((a, s) => a + u.gemsYear[s][y], 0))).median,
    oneTimeGems: summary(us.map((u) => ONE_TIME_SOURCES.reduce((a, s) => a + u.gemsYear[s][y], 0))).median,
    bySourceGems: Object.fromEntries(SOURCES.map((s) => [s, summary(us.map((u) => u.gemsYear[s][y])).median])),
  }));
  const last = yrs[yrs.length - 1];
  const recG = summary(us.map((u) => RECURRING_SOURCES.reduce((a, s) => a + u.gemsYear[s][last], 0))).median;
  const recC = summary(us.map((u) => RECURRING_SOURCES.reduce((a, s) => a + u.coinsYear[s][last], 0))).median;
  const activeAch = ACHIEVEMENTS.filter((a) => !a.onHold && !a.symbolic).length;
  longTerm[pid] = {
    lastYear: last + 1, recurringGemsPerYear: recG, recurringCoinsPerYear: recC,
    achievementsUnlockedShare: summary(us.map((u) => u.achievements.filter((id) => !ACHIEVEMENTS.find((a) => a.id === id)?.symbolic).length / activeAch)).median,
    yearsPerGemItem: PRICES.gem.map((g) => g / Math.max(1e-9, recG)),
    gemItemsPerYear: PRICES.gem.map((g) => recG / g),
    coinItemsPerYear: PRICES.coin.map((c) => recC / c),
  };
}
OUT.F4 = yearly;
OUT.F5 = longTerm;
log("F4/F5");

// ---------- F6: new / continuing / churned (population) ----------
{
  const days = QUICK ? 365 : 1095;
  const { users } = simulatePopulation(ctx(BASE), PERSONAS.filter((p) => p.abuse === "none"), 30, days, SEED);
  const groups: Record<string, UserResult[]> = { new: [], continuing: [], churned: [] };
  for (const u of users) {
    if (!u.loggedIn) continue;
    if (u.churned) groups.churned.push(u);
    else if (u.lifetime < 30) groups.new.push(u);
    else groups.continuing.push(u);
  }
  OUT.F6 = Object.fromEntries(Object.entries(groups).map(([k, us]) => [k, {
    users: us.length, lifetime: summary(us.map((u) => u.lifetime)), coinsPerDay: summary(us.map((u) => freeCoins(u) / Math.max(1, u.lifetime))),
    unspentCoins: summary(us.map((u) => u.coins)), unspentGems: summary(us.map((u) => u.gems)), owned: summary(us.map((u) => u.ownedByRarity.reduce((a, b) => a + b, 0))),
    mythicShare: us.filter((u) => u.firstRarityDay[4] >= 0).length / Math.max(1, us.length),
    strandedCoinsTotal: k === "churned" ? us.reduce((a, u) => a + u.coins, 0) : null,
    personaMix: Object.fromEntries(PERSONAS.map((p) => [p.id, us.filter((u) => u.persona === p.id).length])),
  }]));
  log("F6");
}

// ---------- F7: multiple independent seeds ----------
{
  const per = SEEDS.map((seed) => {
    const run = (pid: string, H: number) => simulateCohort(ctx(BASE, { forceF2P: true, forceLoggedIn: true }, seed), personaById(pid), N, H, seed, [365]);
    const reg = run("regular", 1095), hv = run("heavy", 365), lt = run("light", 365);
    const bot = simulateCohort(ctx(BASE, { spending: false, forceLoggedIn: true }), personaById("abuser"), 20, 30, seed);
    const hv30 = simulateCohort(ctx(BASE, { spending: false, forceLoggedIn: true, forceF2P: true }), personaById("heavy"), 60, 30, seed);
    return {
      seed, regCoinsPerDay: summary(reg.map((u) => u.checkpoints[365].earnedCoins / 365)).median, regGemsPerDay: summary(reg.map((u) => u.checkpoints[365].earnedGems / 365)).median,
      regMythic1y: reach(reg, 4, 365), regMythic3y: reach(reg, 4, 1095), heavyMythic1y: reach(hv, 4, 365), lightCoinsPerDay: summary(lt.map((u) => freeCoins(u) / 365)).median,
      botRatio: summary(bot.map(freeCoins)).median / summary(hv30.map(freeCoins)).median,
    };
  });
  const keys = Object.keys(per[0]).filter((k) => k !== "seed") as (keyof (typeof per)[number])[];
  OUT.F7 = { seeds: SEEDS, per, stats: Object.fromEntries(keys.map((k) => { const v = per.map((p) => p[k] as number); const m = v.reduce((a, b) => a + b, 0) / v.length; return [k, { mean: m, sd: Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1)), min: Math.min(...v), max: Math.max(...v) }]; })) };
  log("F7");
}

// ---------- F7b: mythic payment-path composition (coin-buyable share) × catalog seeds ----------
{
  const mixes: { label: string; mix: [number, number, number] }[] = [
    { label: "보석 전용 100%", mix: [0, 1, 0] },
    { label: "보석 40%·선택 60%(1차 기본)", mix: [0, 0.4, 0.6] },
    { label: "보석 1/3·선택 2/3", mix: [0, 1 / 3, 2 / 3] },
    { label: "선택 결제 100%", mix: [0, 0, 1] },
  ];
  OUT.F7b = mixes.map(({ label, mix }) => {
    const prices: PriceTable = { ...PRICES, currencyMix: [...DEFAULT_CURRENCY_MIX.slice(0, 4), mix] };
    const vals = SEEDS.map((cs) => {
      const c = { ...ctxFor(BASE, prices, { forceF2P: true, forceLoggedIn: true }, GEM_VALUE, cs), slots: SLOTS };
      const reg = simulateCohort(c, regular, Math.max(40, N / 2), 1095, cs);
      const hv = simulateCohort(c, personaById("heavy"), Math.max(40, N / 2), 365, cs);
      return { reg1y: reach(reg, 4, 365), reg3y: reach(reg, 4, 1095), heavy1y: reach(hv, 4, 365) };
    });
    const st = (k: "reg1y" | "reg3y" | "heavy1y") => { const v = vals.map((x) => x[k]); const m = v.reduce((a, b) => a + b, 0) / v.length; return { mean: m, min: Math.min(...v), max: Math.max(...v) }; };
    return { label, mix, reg1y: st("reg1y"), reg3y: st("reg3y"), heavy1y: st("heavy1y") };
  });
  log("F7b");
}

// ---------- F8: win bonus 10/20/30/67% ----------
{
  OUT.F8 = [0.1, 0.2, 0.3, 0.67].map((w) => {
    const m = integerM3(w);
    const at = (wr: number) => {
      const us = simulateCohort(ctx(m, { forceF2P: true, forceLoggedIn: true, winRate: { ...DEFAULT_WIN_RATE, online_random: wr } }), regular, N, 365, SEED, [365]);
      return { coinsPerDay: summary(us.map((u) => freeCoins(u) / 365)).median, mythic1y: reach(us, 4, 365) };
    };
    const lo = at(0.35), mid = at(0.5), hi = at(0.65);
    const heavy = simulateCohort(ctx(m, { spending: false, forceLoggedIn: true, forceF2P: true }), personaById("heavy"), 60, 30, SEED);
    const hC = summary(heavy.map(freeCoins)).median;
    const botAI = simulateCohort(ctx(m, { spending: false, forceLoggedIn: true }), personaById("abuser"), 20, 30, SEED);
    const botRand = simulateCohort(ctx(m, { spending: false, forceLoggedIn: true, winRate: { ...DEFAULT_WIN_RATE, online_random: 0.65 } }), personaById("abuse_random_bot"), 20, 30, SEED);
    return { winPct: w, model: m.id, win: m.match.online_random.win, regular: mid, weak035: lo, strong065: hi, strongOverWeak: hi.coinsPerDay / lo.coinsPerDay, winShareOfMatchCoins: (0.5 * m.match.online_random.win) / (10 + 0.5 * m.match.online_random.win), botAIRatio: summary(botAI.map(freeCoins)).median / hC, botRandomRatio065: summary(botRand.map(freeCoins)).median / hC };
  });
  log("F8");
}

// ---------- F9: no events ----------
{
  const noEv = { ...BASE, id: "M3i-noevent", events: { ...BASE.events, everyDays: 1e9 } };
  const rows = [];
  for (const [label, m] of [["이벤트 있음", BASE], ["이벤트 없음", noEv]] as const) {
    const res: Record<string, unknown> = { label };
    for (const pid of ["light", "regular", "heavy"]) {
      const us = simulateCohort(ctx(m, { forceF2P: true, forceLoggedIn: true }), personaById(pid), N, 1095, SEED, [365]);
      res[pid] = { coinsPerDay1y: summary(us.map((u) => u.checkpoints[365].earnedCoins / 365)).median, mythic1y: reach(us, 4, 365), mythic3y: reach(us, 4, 1095) };
    }
    const pop = simulatePopulation(ctx(m), PERSONAS.filter((p) => p.abuse === "none"), 30, 365, SEED);
    const s = pop.series, tail = (a: Float64Array) => a.slice(275).reduce((x, y) => x + y, 0) / 90;
    res.population = { coinsIssued: tail(s.coinsIssued), coinsSpent: tail(s.coinsSpent), gemsIssued: tail(s.gemsIssued), gemsSpent: tail(s.gemsSpent) };
    rows.push(res);
  }
  OUT.F9 = rows;
  log("F9");
}

// ---------- F10: guest carry-over candidates ----------
{
  const policies = [
    { id: "G0", label: "소급 없음", days: 0, cap: undefined as number | undefined },
    { id: "G7", label: "최근 7일·최대 50경기", days: 7, cap: 50 },
    { id: "G30", label: "최근 30일·상한 없음", days: 30, cap: undefined },
    { id: "G20", label: "기간 무관 최대 20경기", days: 1e9, cap: 20 },
  ];
  const guestRegular: Persona = { ...regular, id: "guest_regular", loggedInShare: 1, payer: null };
  const farmer: Persona = { ...personaById("abuser"), id: "guest_farmer", modeMix: { server_ai: 1 } };
  OUT.F10 = policies.map((pol) => {
    const m = { ...BASE, guestCarryoverDays: pol.days, guestCarryoverMatchCap: pol.cap };
    const res: Record<string, unknown> = { ...pol };
    for (const L of [3, 14, 60]) {
      const us = simulateCohort(ctx(m, { forceF2P: true, spending: false, loginDay: L }), guestRegular, N, L + 30, SEED);
      res[`login${L}`] = { carryCoins: summary(us.map((u) => u.coinsBySource.guest_carryover)).median, creditedMatches: summary(us.map((u) => u.guestMatchesCredited)).median, first30dCoinsAfterLogin: summary(us.map((u) => freeCoins(u))).median };
    }
    const f = simulateCohort(ctx(m, { spending: false, loginDay: 60 }), farmer, 10, 61, SEED);
    res.farmer60 = { carryCoins: summary(f.map((u) => u.coinsBySource.guest_carryover)).median, creditedMatches: summary(f.map((u) => u.guestMatchesCredited)).median };
    return res;
  });
  log("F10");
}

// ---------- F11: quest completion — matches actually needed ----------
{
  const rng: Rng = mulberry32(SEED + 11);
  const pOf = (t: TierId, key: string) => (key === "match" ? 1 : key === "win" ? 0.5 : eventProbability(t, key as EventKey));
  const quests = QUESTS.filter((q) => !q.onHold);
  const trials = QUICK ? 2000 : 20000;
  const need = (t: TierId, key: string, count: number) => {
    const p = pOf(t, key), xs: number[] = [];
    for (let i = 0; i < trials; i++) { let n = 0, c = 0; while (c < count && n < 5000) { n++; if (rng() < p) c++; } xs.push(n); }
    return summary(xs);
  };
  const perQuest = quests.map((q) => ({ id: q.id, label: q.label, period: q.period, difficulty: q.difficulty, byTier: Object.fromEntries((["beginner", "intermediate", "expert"] as TierId[]).map((t) => { const s = need(t, q.key, q.count); return [t, { mean: s.mean, median: s.median, p90: s.p90 }]; })) }));
  // whole daily set (one random quest per difficulty): matches until all three are done; and P(all done | n matches)
  const pools = [0, 1, 2].map((d) => quests.filter((q) => q.period === "daily" && q.difficulty === d));
  const dailySet = Object.fromEntries((["beginner", "casual", "intermediate", "strong", "expert"] as TierId[]).map((t) => {
    const xs: number[] = [];
    const doneBy = Array(16).fill(0);
    for (let i = 0; i < trials; i++) {
      const set = pools.map((pl) => pl[Math.floor(rng() * pl.length)]);
      const c = [0, 0, 0];
      let n = 0;
      while (n < 200 && set.some((q, k) => c[k] < q.count)) { n++; const win = rng() < 0.5; set.forEach((q, k) => { if (q.key === "match" || (q.key === "win" ? win : rng() < pOf(t, q.key))) c[k]++; }); }
      xs.push(n);
      for (let m = n; m < 16; m++) doneBy[m]++;
    }
    return [t, { matches: summary(xs), pAllDoneBy: doneBy.map((x) => x / trials) }];
  }));
  OUT.F11 = { trials, perQuest, dailySet, note: "Events treated as independent per match (correlation ignored). Weekly quests use the same per-match probabilities." };
  log("F11");
}

// ---------- F12: upgrade ratios, saver vs buyer, gem-bought upgrade currency ----------
{
  const focus = (pid: string, cur: "coin" | "gem" = "coin"): Persona => ({ ...personaById(pid), id: `focus_${pid}_${cur}`, spend: "focus", focusCurrency: cur, upgradeAppetite: 1, goalShare: 0, wantByRarity: [0, 0, 0, 0, 0], payer: null });
  const ratios = STEP_RATIOS.map((r) => {
    const up: UpgradeConfig = { curve: "exponential", baseFraction: 0.5, maxLevel: 3, param: 3, steps: r.steps };
    const res: Record<string, unknown> = { ratio: r.label, mythicCosts: upgradeCosts(PRICES.coin[4], up), totalMythicCoins: PRICES.coin[4] + upgradeCosts(PRICES.coin[4], up).reduce((a, b) => a + b, 0) };
    for (const pid of ["light", "regular", "heavy", "extreme"]) {
      const us = simulateCohort(ctx(BASE, { upgrade: up, forceF2P: true, forceLoggedIn: true }), focus(pid), Math.max(40, N / 2), Y5, SEED);
      res[`focus_${pid}`] = { mythicDay: medDay(us.map((u) => u.firstRarityDay[4]), Y5), maxDay: medDay(us.map((u) => u.firstMythicMaxDay), Y5), maxReach1y: us.filter((u) => u.firstMythicMaxDay >= 0 && u.firstMythicMaxDay < 365).length / us.length, maxReach3y: us.filter((u) => u.firstMythicMaxDay >= 0 && u.firstMythicMaxDay < 1095).length / us.length };
    }
    for (const pid of ["regular", "heavy"]) {
      const us = simulateCohort(ctx(BASE, { upgrade: up, forceF2P: true, forceLoggedIn: true }), personaById(pid), Math.max(40, N / 2), Y5, SEED);
      res[`buyer_${pid}`] = { mythicDay: medDay(us.map((u) => u.firstRarityDay[4]), Y5), maxDay: medDay(us.map((u) => u.firstMythicMaxDay), Y5), maxReach3y: us.filter((u) => u.firstMythicMaxDay >= 0 && u.firstMythicMaxDay < 1095).length / us.length, maxReach5y: us.filter((u) => u.firstMythicMaxDay >= 0).length / us.length, upgradeShare: summary(us.map((u) => u.coinsSpent.upgrade / Math.max(1, u.coinsSpent.upgrade + u.coinsSpent.item + u.coinsSpent.slot))).median };
    }
    return res;
  });
  const gemPolicy = (["coin", "same", "either"] as const).map((pol) => {
    const res: Record<string, unknown> = { policy: pol };
    for (const pid of ["regular", "heavy"]) {
      const us = simulateCohort(ctx(BASE, { upgradeCurrency: pol, forceF2P: true, forceLoggedIn: true }), focus(pid, "gem"), Math.max(40, N / 2), Y5, SEED);
      res[pid] = { mythicDay: medDay(us.map((u) => u.firstRarityDay[4]), Y5), maxDay: medDay(us.map((u) => u.firstMythicMaxDay), Y5), gemsOnUpgrade: summary(us.map((u) => u.gemsSpent.upgrade)).median, coinsOnUpgrade: summary(us.map((u) => u.coinsSpent.upgrade)).median };
    }
    return res;
  });
  OUT.F12 = { ratios, gemPolicy };
  log("F12");
}

// ---------- F13: symbolic ultra-high prices ----------
{
  const lt = OUT.F5 as Record<string, { recurringCoinsPerYear: number }>;
  const bigPayer = personaById("big_payer").payer!;
  const paidPerYear = bigPayer.coinsPerPurchase * 12 * bigPayer.monthlyPurchaseProb;
  OUT.F13 = [80_000, 100_000, 500_000, 999_999].map((price) => ({
    price,
    yearsF2P: Object.fromEntries(Object.entries(lt).map(([pid, v]) => [pid, price / Math.max(1, v.recurringCoinsPerYear)])),
    yearsBigPayerPurchaseOnly: price / paidPerYear,
  }));
}

// ---------- F14: Cloudflare free-plan capacity from measured writes ----------
{
  const measured = JSON.parse(readFileSync("docs/economy/results/room-writes.json", "utf8"));
  const perMatch = measured.totalRoomRowWrites + 2; // + cleanup deleteAll/deleteAlarm (estimate)
  const first = measured.perMatch.saveByAction.score; // ≈ first roll of every turn (one per scored turn)
  const designs = [
    { id: "A", label: "현재 구조(실측)", writes: perMatch },
    { id: "B", label: "턴 첫 굴림을 직전 점수 기록과 함께 저장", writes: perMatch - first + 1 },
    { id: "C", label: "턴 내부 상태는 소켓 첨부, 턴 경계만 저장(연구 후보)", writes: perMatch - measured.perMatch.saveByAction.roll },
  ];
  const econ = [0, 2, 3]; // writes per rewarded player-match (0 = economy off)
  const shares = [0.5, 0.7, 1];
  const capacity = designs.flatMap((d) => econ.flatMap((e) => shares.map((sh) => ({ design: d.id, label: d.label, roomWrites: d.writes, econWritesPerPlayerMatch: e, quotaShare: sh, pvpMatchesPerDay: Math.floor((FREE_LIMITS.rowWritesPerDay * sh) / (d.writes + 2 * e)) }))));
  // DO duration (Free 13,000 GB-s/day per D-021 record); 128 MB billed per active object
  const matchSeconds = 95 * 4; // measured commands × 4 s per action (assumption)
  const duration = [1, 0.5, 0.25].map((awake) => ({ awakeShare: awake, gbSecondsPerMatch: matchSeconds * awake * 0.125, matchesPerDay: Math.floor(13_000 / (matchSeconds * awake * 0.125)) }));
  const dau = [2, 4, 8, 15].map((mpd) => ({ pvpMatchesPerDauPerDay: mpd, dauAt300RoomLimit: Math.floor((300 * 2) / mpd), dauAtRowCapB70: Math.floor((Math.floor((FREE_LIMITS.rowWritesPerDay * 0.7) / (designs[1].writes + 4)) * 2) / mpd) }));
  OUT.F14 = { measured, perMatchUsed: perMatch, designs, capacity, duration, dau, notes: [
    "Units: a PvP match has 2 player-matches. DAU = distinct players with ≥1 match that day; new users/day is a different quantity.",
    "DO duration limit 13,000 GB-s/day is the value recorded in D-021 (official docs at that time); awake share depends on hibernation between messages and must be read from the dashboard.",
  ] };
}

writeFileSync("docs/economy/results/followup.json", JSON.stringify(round({ generated: { seed: SEED, seeds: SEEDS, users: N, quick: QUICK, runtimeSeconds: Math.round((performance.now() - t0) / 1000) }, ...OUT }), null, 1));
writeFileSync("src/economy/data/lab-followup.json", JSON.stringify(round({ generated: { seed: SEED, seeds: SEEDS, users: N, quick: QUICK, runtimeSeconds: Math.round((performance.now() - t0) / 1000) }, itemTypes: ITEM_TYPE_LABEL, rarityLabels: RARITIES.map((r) => RARITY_LABEL[r]), targetDays: TARGET_DAYS, ...OUT })));
log("done");
void MODELS; void scaleCoins; void ABUSE_VARIANTS; void TIER_IDS; void niceRound; void simulateUser; void F2P;

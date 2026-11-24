/**
 * YachtLab economy study — full experiment runner (reproducible; fixed seeds).
 *
 *   npx tsx scripts/economy/run-experiments.ts [usersPerPersona=200] [--quick]
 *
 * Steps
 *  1. Achievement reward table from measured per-match probabilities (reference tier: 중급).
 *  2. Quest analysis: completion probability per day/week and expected matches per tier.
 *  3. Income-only runs (no spending) → normalize each model's coin faucets so the reference user
 *     (일반 유저, logged-in, F2P) earns a median of COIN_UNIT coins/day over 1 year.
 *  4. Price back-calculation from the reference income (common price table for all models).
 *  5. Full runs with spending: model × persona × horizon (7d..5y).
 *  6. Upgrade-curve comparison, abuse comparison, sensitivity analysis.
 *  7. Population runs (arrivals + churn) → issuance/consumption/balance and Cloudflare usage.
 * Outputs: docs/economy/results/*.json (report.ts adds model-persona-horizon.csv), docs/economy/RESULTS-GENERATED.md, src/economy/data/lab-summary.json
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { ACHIEVEMENTS, QUESTS, TIER_IDS, TIER_LABEL, achievementGems, difficultyBand, eventProbability, crossScoreRate, type TierId, type AchievementDef } from "../../src/economy/content";
import { MODELS, MODES, MODE_LABEL, MODE_TRUST, scaleCoins, modelById, type EconomyModel } from "../../src/economy/models";
import { ABUSE_VARIANTS, PERSONAS, personaById, type Persona } from "../../src/economy/personas";
import { CURVE_PRESETS, CURVE_LABEL, DEFAULT_CATALOG, DEFAULT_CURRENCY_MIX, RARITIES, RARITY_LABEL, TARGET_DAYS, buildCatalog, derivePrices, deriveSlots, niceRound, upgradeCosts, type PriceTable, type UpgradeConfig, type CatalogConfig } from "../../src/economy/pricing";
import { DEFAULT_WIN_RATE, SOURCES, SOURCE_LABEL, simulateCohort, simulatePopulation, simulateUser, type SimContext, type UserResult } from "../../src/economy/simulate";
import { couponExpectedMatches, couponQuantile, matchesForProbability } from "../../src/economy/dice-exact";
import { DEFAULT_USAGE, FREE_LIMITS, dailyUsage, paidMonthlyUsd } from "../../src/economy/cloudflare";
import { gini, mulberry32, negBinomial, summary } from "../../src/economy/rng";
import matchEvents from "../../src/economy/data/match-events.json";
import exactPmf from "../../src/economy/data/exact-score-pmf.json";
import rare from "../../src/economy/data/rare-events.json";

const QUICK = process.argv.includes("--quick");
const N = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? (QUICK ? 40 : 200));
const SEED = 20261124;
const HORIZONS = QUICK ? [7, 30, 90, 365] : [7, 30, 90, 180, 365, 1095, 1825];
const MAXDAYS = HORIZONS[HORIZONS.length - 1];
const COIN_UNIT = 100; // reference median coins/day after normalization (abstract unit)
const REF = "regular";
const REF_TIER: TierId = "intermediate";
const OUT = "docs/economy/results";
mkdirSync(OUT, { recursive: true });
const t0 = performance.now();
const log = (...a: unknown[]) => console.log(`[${((performance.now() - t0) / 1000).toFixed(0)}s]`, ...a);
const r4 = (x: number) => (Number.isFinite(x) ? Number(x.toPrecision(4)) : x);
const round = (o: unknown): unknown => JSON.parse(JSON.stringify(o, (_k, v) => (typeof v === "number" && !Number.isInteger(v) ? r4(v) : v)));
const save = (name: string, data: unknown) => writeFileSync(`${OUT}/${name}.json`, JSON.stringify(round(data), null, 1));

// ---------- 1. achievements: expected matches & reward ----------
const regular = personaById(REF);
const regularMatchesPerActiveDay = regular.matchesMean;
function expectedMatches(a: AchievementDef, tier: TierId): number {
  if (a.key === "streak") { const p = 0.5; return (1 / p ** a.count - 1) / (1 - p); }
  if (a.key === "activeDays") return a.count * regularMatchesPerActiveDay;
  if (a.key === "dailyQuests") return a.count * (regularMatchesPerActiveDay + 1.5) / 0.6; // ≈ matches/day ÷ P(all daily done) (measured below)
  if (a.key === "yachtFaces") return couponExpectedMatches([1, 2, 3, 4, 5, 6].map((f) => eventProbability(tier, `yachtFace${f}` as never)));
  const p = eventProbability(tier, a.key as never, 0.5);
  return p > 0 ? a.count / p : Infinity;
}
const achievementTable = ACHIEVEMENTS.map((a) => {
  const byTier = Object.fromEntries(TIER_IDS.map((t) => [t, expectedMatches(a, t)]));
  const E = byTier[REF_TIER];
  const pPerMatch = Object.fromEntries(TIER_IDS.map((t) => [t, a.count === 1 && !["streak", "activeDays", "dailyQuests", "yachtFaces"].includes(a.key) ? eventProbability(t, a.key as never) : null]));
  const band = difficultyBand(Number.isFinite(E) ? E : byTier.expert);
  const gems = a.symbolic ? Math.min(achievementGems(Number.isFinite(E) ? E : byTier.expert), 300) : achievementGems(E);
  const extra: Record<string, unknown> = {};
  if (a.key === "yachtFaces") { const p = [1, 2, 3, 4, 5, 6].map((f) => eventProbability(REF_TIER, `yachtFace${f}` as never)); extra.p50 = couponQuantile(p, 0.5); extra.p90 = couponQuantile(p, 0.9); }
  return { ...a, expectedMatches: byTier, pPerMatch, band: band.band, bandLabel: band.label, rewardGems: gems, matchesFor90pct: pPerMatch[REF_TIER] ? matchesForProbability(pPerMatch[REF_TIER] as number, 0.9) : null, ...extra };
});
const ACH_GEMS = Object.fromEntries(achievementTable.map((a) => [a.id, a.rewardGems]));
log("achievements", achievementTable.length);

// ---------- 2. quest analysis ----------
function questAnalysis() {
  const rr = mulberry32(SEED + 2);
  const days = Array.from({ length: 20000 }, () => Math.max(1, negBinomial(rr, regular.matchesMean, regular.matchesShape)));
  const binomTailFast = (n: number, p: number, k: number) => { if (k <= 0) return 1; let pmf = (1 - p) ** n, cdf = pmf; for (let i = 1; i < k; i++) { pmf *= ((n - i + 1) / i) * (p / (1 - p)); cdf += pmf; } return Math.max(0, 1 - cdf); };
  return QUESTS.map((q) => {
    const byTier = Object.fromEntries(TIER_IDS.map((t) => {
      const p = q.key === "match" ? 1 : q.key === "win" ? 0.5 : eventProbability(t, q.key);
      const periodDays = q.period === "daily" ? 1 : q.period === "weekly" ? 7 : 30;
      // matches in the period for the reference persona (active days × matches)
      let prob = 0;
      for (const n0 of days) {
        const n = q.period === "daily" ? n0 : Math.round(n0 * periodDays * regular.activeDayProb);
        prob += q.key === "match" ? (n >= q.count ? 1 : 0) : binomTailFast(n, p, q.count);
      }
      return [t, { pPerMatch: p, expectedMatches: q.count / p, completionProb: prob / days.length }];
    }));
    return { ...q, byTier };
  });
}
const questTable = questAnalysis();
log("quests", questTable.length);

// ---------- context helpers ----------
function makeCtx(model: EconomyModel, prices: PriceTable, opts: Partial<SimContext> & { catalogCfg?: CatalogConfig; slotDays?: number[] } = {}): SimContext {
  const catalog = buildCatalog(opts.catalogCfg ?? DEFAULT_CATALOG, prices, MAXDAYS + 1, SEED);
  return {
    model, catalog,
    upgrade: opts.upgrade ?? CURVE_PRESETS[1],
    slots: opts.slots ?? deriveSlots(COIN_UNIT, refGemsPerDay, opts.slotDays),
    gemValueInCoins: opts.gemValueInCoins ?? gemValue,
    winRate: opts.winRate ?? DEFAULT_WIN_RATE,
    achievementGems: ACH_GEMS,
    spending: opts.spending ?? true,
    forceF2P: opts.forceF2P, forceLoggedIn: opts.forceLoggedIn, activityMultiplier: opts.activityMultiplier,
  };
}
const totalCoins = (u: UserResult) => SOURCES.reduce((a, s) => a + u.coinsBySource[s], 0);
const totalGems = (u: UserResult) => SOURCES.reduce((a, s) => a + u.gemsBySource[s], 0);
const freeCoins = (u: UserResult) => totalCoins(u) - u.coinsBySource.purchase;
const freeGems = (u: UserResult) => totalGems(u) - u.gemsBySource.purchase;

// ---------- 3. income-only normalization ----------
const dummyPrices: PriceTable = { coin: [1, 1, 1, 1, 1], gem: [1, 1, 1, 1, 1], currencyMix: DEFAULT_CURRENCY_MIX };
let refGemsPerDay = 1, gemValue = 50;
const normalization: Record<string, { rawMedianCoinsPerDay: number; factor: number; medianGemsPerDay: number }> = {};
const normalizedModels: Record<string, EconomyModel> = {};
for (const m of MODELS) {
  const ctx = makeCtx(m, dummyPrices, { spending: false, forceF2P: true, forceLoggedIn: true });
  const us = simulateCohort(ctx, regular, N, 365, SEED);
  const med = summary(us.map((u) => freeCoins(u) / 365)).median;
  const factor = COIN_UNIT / med;
  normalizedModels[m.id] = scaleCoins(m, factor);
  const us2 = simulateCohort(makeCtx(normalizedModels[m.id], dummyPrices, { spending: false, forceF2P: true, forceLoggedIn: true }), regular, N, 365, SEED);
  normalization[m.id] = { rawMedianCoinsPerDay: med, factor, medianGemsPerDay: summary(us2.map((u) => freeGems(u) / 365)).median };
}
log("normalization", normalization);

// ---------- 4. prices (common table from the recommended-structure reference, M3) ----------
refGemsPerDay = normalization.M3.medianGemsPerDay;
gemValue = COIN_UNIT / refGemsPerDay; // time-equivalence: 1 gem ≈ coins earned in the time it takes to earn 1 gem
const PRICES = derivePrices(COIN_UNIT, refGemsPerDay);
const SLOTS = deriveSlots(COIN_UNIT, refGemsPerDay);
log("prices", PRICES, "gemValue", gemValue);

// ---------- 5. full runs ----------
type Cell = Record<string, unknown>;
function horizonMetrics(us: UserResult[], H: number, persona: Persona): Cell {
  const cp = us.map((u) => u.checkpoints[H]).filter(Boolean);
  const loggedIn = us.filter((u) => u.loggedIn);
  const li = loggedIn.map((u) => u.checkpoints[H]).filter(Boolean);
  const perDay = (x: number) => x / H;
  const earnedC = li.map((c) => perDay(c.earnedCoins)), earnedG = li.map((c) => perDay(c.earnedGems));
  const reach = (arr: number[]) => (loggedIn.length ? loggedIn.filter((u) => arr[loggedIn.indexOf(u)] >= 0 && arr[loggedIn.indexOf(u)] < H).length / loggedIn.length : 0);
  const rarityReach = RARITIES.map((_, k) => reach(loggedIn.map((u) => u.firstRarityDay[k])));
  const rarityDays = RARITIES.map((_, k) => summary(loggedIn.map((u) => u.firstRarityDay[k]).filter((d) => d >= 0 && d < H).map((d) => d + 1)));
  const rarityMatches = RARITIES.map((_, k) => summary(loggedIn.filter((u) => u.firstRarityDay[k] >= 0 && u.firstRarityDay[k] < H).map((u) => u.firstRarityMatches[k])));
  return {
    users: us.length, loggedIn: loggedIn.length,
    coinsPerDay: summary(earnedC), gemsPerDay: summary(earnedG),
    balanceCoins: summary(li.map((c) => c.coins)), balanceGems: summary(li.map((c) => c.gems)), giniBalance: gini(li.map((c) => c.coins + c.gems * gemValue)),
    owned: summary(li.map((c) => c.owned)),
    rarityReach, rarityDaysMedian: rarityDays.map((s) => s.median), rarityMatchesMedian: rarityMatches.map((s) => s.median),
    mythicReach: rarityReach[4],
    maxUpgradeReach: reach(loggedIn.map((u) => u.firstMaxUpgradeDay)), mythicMaxReach: reach(loggedIn.map((u) => u.firstMythicMaxDay)),
    purchasingPowerMythic: summary(li.map((c) => (c.coins + c.gems * gemValue) / PRICES.coin[4])),
    guestShare: 1 - loggedIn.length / Math.max(1, us.length),
    persona: persona.id,
  };
}
function sourceShares(us: UserResult[]) {
  const c = Object.fromEntries(SOURCES.map((s) => [s, us.reduce((a, u) => a + u.coinsBySource[s], 0)]));
  const g = Object.fromEntries(SOURCES.map((s) => [s, us.reduce((a, u) => a + u.gemsBySource[s], 0)]));
  const ct = Object.values(c).reduce((a, b) => a + b, 0) || 1, gt = Object.values(g).reduce((a, b) => a + b, 0) || 1;
  return { coins: Object.fromEntries(SOURCES.map((s) => [s, c[s] / ct])), gems: Object.fromEntries(SOURCES.map((s) => [s, g[s] / gt])) };
}
const ALL_PERSONAS = [...PERSONAS, ...ABUSE_VARIANTS.filter((p) => p.id !== "abuser")];
const full: Record<string, Record<string, { horizons: Record<number, Cell>; sources: ReturnType<typeof sourceShares>; achievementsPerUser: number; achievementUnlock: Record<string, number> }>> = {};
for (const m of MODELS) {
  const ctx = makeCtx(normalizedModels[m.id], PRICES);
  full[m.id] = {};
  for (const p of ALL_PERSONAS) {
    const us = simulateCohort(ctx, p, N, MAXDAYS, SEED, HORIZONS);
    const horizons = Object.fromEntries(HORIZONS.map((H) => [H, horizonMetrics(us, H, p)]));
    const li = us.filter((u) => u.loggedIn);
    const achievementUnlock = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, li.filter((u) => (u.achievementDay[a.id] ?? Infinity) < 365).length / Math.max(1, li.length)]));
    full[m.id][p.id] = { horizons, sources: sourceShares(li), achievementsPerUser: li.reduce((a, u) => a + u.achievements.length, 0) / Math.max(1, li.length), achievementUnlock };
  }
  log("model", m.id);
}
save("full-runs", { N, horizons: HORIZONS, prices: PRICES, slots: SLOTS, gemValue, full });

// ---------- 6a. upgrade curves ----------
const curveTable = CURVE_PRESETS.map((cfg) => ({
  curve: cfg.curve, label: CURVE_LABEL[cfg.curve],
  costs: RARITIES.map((_, k) => upgradeCosts(PRICES.coin[k], cfg)),
  extendedTo5: RARITIES.map((_, k) => upgradeCosts(PRICES.coin[k], { ...cfg, maxLevel: 5 })),
}));
const curveRuns = CURVE_PRESETS.flatMap((cfg) => [0.25, 0.5, 1].map((bf) => {
  const ucfg: UpgradeConfig = { ...cfg, baseFraction: bf };
  const ctx = makeCtx(normalizedModels.M3, PRICES, { upgrade: ucfg, forceF2P: true, forceLoggedIn: true });
  const res: Cell = { curve: cfg.curve, baseFraction: bf, costsMythic: upgradeCosts(PRICES.coin[4], ucfg) };
  for (const pid of ["regular", "heavy", "extreme"]) {
    const us = simulateCohort(ctx, personaById(pid), Math.max(40, N / 2), 365, SEED, [365]);
    res[pid] = {
      maxUpgradeReach1y: us.filter((u) => u.firstMaxUpgradeDay >= 0).length / us.length,
      mythicMaxReach1y: us.filter((u) => u.firstMythicMaxDay >= 0).length / us.length,
      upgradeShareOfSpend: us.reduce((a, u) => a + u.coinsSpent.upgrade, 0) / Math.max(1, us.reduce((a, u) => a + u.coinsSpent.upgrade + u.coinsSpent.item + u.coinsSpent.slot, 0)),
      mythicReach1y: us.filter((u) => u.firstRarityDay[4] >= 0).length / us.length,
    };
  }
  return res;
}));
save("upgrade-curves", { curveTable, curveRuns });
log("curves");

// ---------- 6b. abuse ----------
const abuse = MODELS.map((m) => {
  const ctx = makeCtx(normalizedModels[m.id], PRICES, { spending: false, forceLoggedIn: true, forceF2P: true });
  const honest = simulateCohort(ctx, personaById("heavy"), Math.max(40, N / 2), 30, SEED);
  const extreme = simulateCohort(ctx, personaById("extreme"), Math.max(40, N / 2), 30, SEED);
  const hC = summary(honest.map(freeCoins)).median, hG = summary(honest.map(freeGems)).median;
  const eC = summary(extreme.map(freeCoins)).median;
  const variants = ABUSE_VARIANTS.map((v) => {
    const us = simulateCohort(ctx, v, 20, 30, SEED);
    const c = summary(us.map(freeCoins)).median, g = summary(us.map(freeGems)).median;
    return { id: v.id, label: v.label, coins30d: c, gems30d: g, ratioVsHeavy: c / hC, ratioVsExtreme: c / eC, gemRatioVsHeavy: g / Math.max(1, hG), hoursPerDay: (v.matchesMean * v.minutesPerMatch) / 60 };
  });
  // multi-account: new-user rewards per extra account (no transfer possible → value locked in each account)
  const multi = { coinsPerAccount: normalizedModels[m.id].newUser.coins, gemsPerAccount: normalizedModels[m.id].newUser.gems, transferable: false };
  return { model: m.id, heavyCoins30d: hC, extremeCoins30d: eC, heavyGems30d: hG, variants, multi };
});
save("abuse", abuse);
log("abuse");

// ---------- 6c. sensitivity (recommended structure M3; reference + heavy, F2P) ----------
type Sens = { param: string; value: string; regMythic1y: number; regMythic6m: number; heavyMythic6m: number; regCoinsPerDay: number; regGemsPerDay: number; regBalance1y: number; casualMythic1y: number; lightMythic1y: number };
function sensRun(label: string, value: string, model: EconomyModel, opts: Partial<SimContext> & { catalogCfg?: CatalogConfig; prices?: PriceTable } = {}): Sens {
  const ctx = makeCtx(model, opts.prices ?? PRICES, { forceF2P: true, ...opts });
  const n = Math.max(40, N / 2);
  const reg = simulateCohort(ctx, personaById("regular"), n, 365, SEED, [182, 365]);
  const heavy = simulateCohort(ctx, personaById("heavy"), n, 182, SEED, [182]);
  const light = simulateCohort(ctx, personaById("light"), n, 365, SEED, [365]).filter((u) => u.loggedIn);
  const occ = simulateCohort(ctx, personaById("occasional"), n, 365, SEED, [365]).filter((u) => u.loggedIn);
  const li = reg.filter((u) => u.loggedIn);
  const reachBy = (us: UserResult[], H: number) => us.filter((u) => u.firstRarityDay[4] >= 0 && u.firstRarityDay[4] < H).length / Math.max(1, us.length);
  return {
    param: label, value,
    regMythic1y: reachBy(li, 365), regMythic6m: reachBy(li, 182), heavyMythic6m: reachBy(heavy, 182),
    regCoinsPerDay: summary(li.map((u) => freeCoins(u) / 365)).median, regGemsPerDay: summary(li.map((u) => freeGems(u) / 365)).median,
    regBalance1y: summary(li.map((u) => u.coins)).median, lightMythic1y: reachBy(light, 365), casualMythic1y: reachBy(occ, 365),
  };
}
const M3 = normalizedModels.M3;
const sensitivity: Sens[] = [];
sensitivity.push(sensRun("기준", "M3 기본값", M3));
for (const a of [0.5, 0.75, 1.5, 2]) sensitivity.push(sensRun("활동량 배수", `×${a}`, M3, { activityMultiplier: a }));
for (const w of [0.4, 0.6]) sensitivity.push(sensRun("온라인 승률", String(w), M3, { winRate: { ...DEFAULT_WIN_RATE, online_random: w, online_friend: w } }));
for (const k of [0.5, 2]) sensitivity.push(sensRun("목표 기간 배수(가격)", `×${k}`, M3, { prices: derivePrices(COIN_UNIT, refGemsPerDay, { coin: TARGET_DAYS.coin.map((d) => d * k), gem: TARGET_DAYS.gem.map((d) => d * k) }) }));
for (const s of [5, 20]) sensitivity.push(sensRun("소프트캡 경기 수", String(s), { ...M3, softCapMatches: s }));
for (const a of [0, 0.5]) sensitivity.push(sensRun("소프트캡 이후 배율", String(a), { ...M3, afterSoftCap: a }));
for (const k of [0.5, 2]) sensitivity.push(sensRun("신상품 출시 빈도", `×${k}`, M3, { catalogCfg: { ...DEFAULT_CATALOG, perMonth: DEFAULT_CATALOG.perMonth.map((x) => x * k) as CatalogConfig["perMonth"] } }));
for (const k of [0.5, 2]) sensitivity.push(sensRun("업적 보석 배수", `×${k}`, { ...M3, achievementGemScale: k }));
for (const ev of [0, 1]) sensitivity.push(sensRun("특별 이벤트", ev ? "4주마다" : "없음", { ...M3, events: { ...M3.events, everyDays: ev ? 28 : 1e9 } }));
sensitivity.push(sensRun("통화 구성", "신화 보석 전용 100%", M3, { prices: { ...PRICES, currencyMix: [...DEFAULT_CURRENCY_MIX.slice(0, 4), [0, 1, 0]] } }));
save("sensitivity", sensitivity);
log("sensitivity", sensitivity.length);

// ---------- 6d. payment effect ----------
const payment = ["small_payer", "big_payer"].map((pid) => {
  const p = personaById(pid);
  const ctxPaid = makeCtx(M3, PRICES);
  const ctxF2P = makeCtx(M3, PRICES, { forceF2P: true });
  const paid = simulateCohort(ctxPaid, p, Math.max(40, N / 2), 365, SEED, [30, 365]);
  const f2p = simulateCohort(ctxF2P, p, Math.max(40, N / 2), 365, SEED, [30, 365]);
  const owned = (us: UserResult[]) => summary(us.map((u) => u.ownedByRarity.reduce((a, b) => a + b, 0)));
  const mythic = (us: UserResult[], H: number) => summary(us.map((u) => (u.firstRarityDay[4] >= 0 && u.firstRarityDay[4] < H ? u.firstRarityDay[4] + 1 : H + 1))).median;
  return { persona: pid, paidOwned1y: owned(paid), f2pOwned1y: owned(f2p), paidMythicDay: mythic(paid, 365), f2pMythicDay: mythic(f2p, 365), paidGemShare: paid.reduce((a, u) => a + u.gemsBySource.purchase, 0) / Math.max(1, paid.reduce((a, u) => a + totalGems(u), 0)) };
});
save("payment", payment);
log("payment");

// ---------- 7. population & Cloudflare ----------
const popPersonas = PERSONAS;
const popDays = QUICK ? 365 : MAXDAYS;
function populationRun(model: EconomyModel, arrivals: number, days: number, opts: Partial<SimContext> = {}) {
  const ctx = makeCtx(model, PRICES, opts);
  const { series, users, bySource } = simulatePopulation(ctx, popPersonas, arrivals, days, SEED + arrivals);
  const sample = (arr: Float64Array, step = 7) => Array.from({ length: Math.ceil(days / step) }, (_, i) => arr.slice(i * step, (i + 1) * step).reduce((a, b) => a + b, 0) / Math.min(step, days - i * step));
  let cumC = 0, cumG = 0, cumSC = 0, cumSG = 0;
  const outstandingCoins: number[] = [], outstandingGems: number[] = [];
  for (let d = 0; d < days; d++) { cumC += series.coinsIssued[d]; cumG += series.gemsIssued[d]; cumSC += series.coinsSpent[d]; cumSG += series.gemsSpent[d]; if (d % 7 === 6 || d === days - 1) { outstandingCoins.push(cumC - cumSC); outstandingGems.push(cumG - cumSG); } }
  const usage = Array.from({ length: days }, (_, d) => {
    const mi = (m: string) => series.byMode[MODES.indexOf(m as never)][d];
    return dailyUsage({ online_random: mi("online_random"), online_friend: mi("online_friend"), server_ai: mi("server_ai") }, series.rewardedMatches[d], series.purchases[d]);
  });
  const usageNoEcon = Array.from({ length: days }, (_, d) => {
    const mi = (m: string) => series.byMode[MODES.indexOf(m as never)][d];
    return dailyUsage({ online_random: mi("online_random"), online_friend: mi("online_friend"), server_ai: mi("server_ai") }, 0, 0);
  });
  const usageRoomAI = Array.from({ length: days }, (_, d) => {
    const mi = (m: string) => series.byMode[MODES.indexOf(m as never)][d];
    return dailyUsage({ online_random: mi("online_random"), online_friend: mi("online_friend"), server_ai: mi("server_ai") }, series.rewardedMatches[d], series.purchases[d], { ...DEFAULT_USAGE, serverAiWritesPerMatch: 120 });
  });
  const last = days - 1;
  const steady = (f: (i: number) => number) => { const xs = Array.from({ length: Math.min(90, days) }, (_, i) => f(last - i)); return xs.reduce((a, b) => a + b, 0) / xs.length; };
  const users365 = users.filter((u) => u.loggedIn);
  return {
    model: model.id, arrivals, days,
    weekly: { dau: sample(series.dau), alive: sample(series.alive), matches: sample(series.matches), serverMatches: sample(series.serverMatches), coinsIssued: sample(series.coinsIssued), gemsIssued: sample(series.gemsIssued), coinsSpent: sample(series.coinsSpent), gemsSpent: sample(series.gemsSpent), rowWrites: sample(Float64Array.from(usage.map((u) => u.rowWrites))), rowUtil: sample(Float64Array.from(usage.map((u) => u.utilization.rowWrites))) },
    outstandingCoins, outstandingGems,
    sourcesCoins: bySource.coins, sourcesGems: bySource.gems,
    steadyState: {
      dau: steady((i) => series.dau[i]), matchesPerDay: steady((i) => series.matches[i]), serverMatchesPerDay: steady((i) => series.serverMatches[i]),
      coinsIssuedPerDay: steady((i) => series.coinsIssued[i]), coinsSpentPerDay: steady((i) => series.coinsSpent[i]), gemsIssuedPerDay: steady((i) => series.gemsIssued[i]), gemsSpentPerDay: steady((i) => series.gemsSpent[i]),
      rowWritesPerDay: steady((i) => usage[i].rowWrites), rowWritesRoomAI: steady((i) => usageRoomAI[i].rowWrites), rowWritesNoEconomy: steady((i) => usageNoEcon[i].rowWrites), rowUtil: steady((i) => usage[i].utilization.rowWrites), doUtil: steady((i) => usage[i].utilization.doRequests), workerUtil: steady((i) => usage[i].utilization.workerRequests),
      peakRowUtil: Math.max(...usage.map((u) => u.utilization.rowWrites)),
      paidUsdPerMonth: paidMonthlyUsd(steady((i) => usage[i].rowWrites), steady((i) => usage[i].doRequests), steady((i) => usage[i].workerRequests)),
    },
    balanceGini: gini(users365.map((u) => u.coins + u.gems * gemValue)),
    newVsVeteran: (() => {
      // purchasing power (balance + owned value) of users alive at the end, by tenure
      const alive = users365.filter((u) => u.lifetime >= 1);
      const bucket = (lo: number, hi: number) => summary(alive.filter((u) => u.lifetime >= lo && u.lifetime < hi).map((u) => u.ownedByRarity.reduce((a, b, k) => a + b * PRICES.coin[k], 0) + u.coins));
      return { tenure0_30: bucket(0, 30), tenure30_180: bucket(30, 180), tenure180_365: bucket(180, 365), tenure365p: bucket(365, 1e9) };
    })(),
  };
}
const population = { M3: populationRun(M3, 30, popDays), byModel: MODELS.filter((m) => !m.counterfactual).map((m) => populationRun(normalizedModels[m.id], 30, 365)) };
const scale = [10, 30, 100, 300].map((a) => { const r = populationRun(M3, a, 365); return { arrivals: a, ...r.steadyState }; });
save("population", { population, scale, usageAssumptions: DEFAULT_USAGE, freeLimits: FREE_LIMITS });
log("population");

// ---------- 8. price recommendations ----------
const ref = full.M3.regular.horizons[365] as Cell & { coinsPerDay: { p25: number; median: number; p75: number }; gemsPerDay: { p25: number; median: number; p75: number } };
const priceRanges = RARITIES.map((rar, k) => ({
  rarity: rar, label: RARITY_LABEL[rar],
  targetDaysCoin: TARGET_DAYS.coin[k], targetDaysGem: TARGET_DAYS.gem[k],
  coin: { low: niceRound(TARGET_DAYS.coin[k] * 0.67 * COIN_UNIT), mid: PRICES.coin[k], high: niceRound(TARGET_DAYS.coin[k] * 1.5 * COIN_UNIT) },
  gem: { low: niceRound(TARGET_DAYS.gem[k] * 0.67 * refGemsPerDay), mid: PRICES.gem[k], high: niceRound(TARGET_DAYS.gem[k] * 1.5 * refGemsPerDay) },
  daysByPersona: Object.fromEntries(["occasional", "light", "regular", "heavy", "extreme"].map((pid) => {
    const c = (full.M3[pid].horizons[365] as Cell & { coinsPerDay: { median: number }; gemsPerDay: { median: number } });
    return [pid, { coinDays: PRICES.coin[k] / Math.max(1e-9, c.coinsPerDay.median), gemDays: PRICES.gem[k] / Math.max(1e-9, c.gemsPerDay.median) }];
  })),
}));
const symbolic = (() => {
  // symbolic ultra-high item: ~1 year of an extreme heavy F2P user's income; regular ≈ several years
  const ext = (full.M3.extreme.horizons[365] as Cell & { coinsPerDay: { median: number } }).coinsPerDay.median;
  const price = niceRound(ext * 365);
  const daysFor = Object.fromEntries(["regular", "heavy", "extreme"].map((pid) => [pid, price / (full.M3[pid].horizons[365] as Cell & { coinsPerDay: { median: number } }).coinsPerDay.median]));
  return { coinPrice: price, daysFor, note: "코인 전용, 업적 아이템 아님. 결제 코인으로도 살 수 있으므로 능력치가 없는 순수 외형이어야 함." };
})();
const upgradeRec = { curve: "exponential", baseFraction: 0.5, maxLevel: 3, costs: RARITIES.map((_, k) => ({ rarity: RARITY_LABEL[RARITIES[k]], l1to2: upgradeCosts(PRICES.coin[k], CURVE_PRESETS[1])[0], l2to3: upgradeCosts(PRICES.coin[k], CURVE_PRESETS[1])[1] })) };
save("prices", { coinUnit: COIN_UNIT, refGemsPerDay, gemValue, prices: PRICES, priceRanges, slots: SLOTS, symbolic, upgradeRec, reference: { coinsPerDay: ref.coinsPerDay, gemsPerDay: ref.gemsPerDay } });

// ---------- 9. catalog analysis outputs ----------
save("quests", questTable);
save("achievements", achievementTable);
save("normalization", { coinUnit: COIN_UNIT, normalization, models: MODELS.map((m) => ({ id: m.id, label: m.label, summary: m.summary, counterfactual: !!m.counterfactual })) });

// ---------- lab summary (compact) ----------
const pick = (c: Cell, keys: string[]) => Object.fromEntries(keys.map((k) => [k, c[k]]));
const lab = {
  generated: { seed: SEED, usersPerPersona: N, horizons: HORIZONS, quick: QUICK, runtimeSeconds: Math.round((performance.now() - t0) / 1000) },
  coinUnit: COIN_UNIT, gemValue, refGemsPerDay, prices: PRICES, slots: SLOTS, priceRanges, symbolic, upgradeRec,
  models: MODELS.map((m) => ({ id: m.id, label: m.label, summary: m.summary, counterfactual: !!m.counterfactual, factor: normalization[m.id].factor, gemsPerDay: normalization[m.id].medianGemsPerDay })),
  personas: ALL_PERSONAS.map((p) => ({ id: p.id, label: p.label, activeDayProb: p.activeDayProb, matchesMean: p.matchesMean, minutesPerMatch: p.minutesPerMatch, spend: p.spend, payer: !!p.payer, abuse: p.abuse })),
  grid: Object.fromEntries(MODELS.map((m) => [m.id, Object.fromEntries(ALL_PERSONAS.map((p) => [p.id, {
    sources: full[m.id][p.id].sources,
    h: Object.fromEntries(HORIZONS.map((H) => { const c = full[m.id][p.id].horizons[H] as Cell; return [H, pick(c, ["coinsPerDay", "gemsPerDay", "balanceCoins", "balanceGems", "rarityReach", "rarityDaysMedian", "maxUpgradeReach", "mythicMaxReach", "giniBalance"])]; })),
  }]))])),
  quests: questTable.map((q) => ({ id: q.id, period: q.period, difficulty: q.difficulty, label: q.label, byTier: q.byTier })),
  achievements: achievementTable.map((a) => ({ id: a.id, group: a.group, label: a.label, expectedMatches: a.expectedMatches, pPerMatch: a.pPerMatch, band: a.band, bandLabel: a.bandLabel, rewardGems: a.rewardGems, symbolic: !!a.symbolic, note: a.note ?? null, unlock1y: Object.fromEntries(["light", "regular", "heavy", "extreme"].map((pid) => [pid, full.M3[pid].achievementUnlock[a.id]])) })),
  abuse, sensitivity, payment,
  curves: { curveTable, curveRuns },
  population: { M3: population.M3, byModel: population.byModel.map((p) => ({ model: p.model, steadyState: p.steadyState, sourcesCoins: p.sourcesCoins, sourcesGems: p.sourcesGems, balanceGini: p.balanceGini })), scale },
  rare: { exact: rare.exact, importanceSampling: Object.fromEntries(Object.entries(rare.importanceSampling).map(([k, v]) => [k, { p: (v as { p: number }).p, se: (v as { se: number }).se }])), exactTail: exactPmf.tailAtLeast, exactCheck: exactPmf.check, headToHead: exactPmf.headToHead, exactPmf: exactPmf.pmf },
  tiers: TIER_IDS.map((t) => ({ id: t, label: TIER_LABEL[t], mean: (matchEvents.mirror as Record<string, { meanTotal: number }>)[t].meanTotal, hist: (matchEvents.mirror as Record<string, { hist: number[] }>)[t].hist, vs: Object.fromEntries(TIER_IDS.map((u) => [u, crossScoreRate(t, u)])) })),
  modes: MODES.map((m) => ({ id: m, label: MODE_LABEL[m], trust: MODE_TRUST[m] })),
  sourceLabels: SOURCE_LABEL,
};
writeFileSync("src/economy/data/lab-summary.json", JSON.stringify(round(lab)));
log("done");
void modelById;

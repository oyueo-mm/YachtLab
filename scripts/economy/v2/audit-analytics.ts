/** Closed-form draw, catalog and capacity analysis plus synthetic reimbursement ledger. */
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { AUDIT_CANDIDATES, SINGLE, POLICIES, INTERACTION, BOOSTERS, persona, POPULATION } from "../../../src/economy/v2/candidates";
import { pricedCatalog, drawPools, DRAW_TIER_P } from "../../../src/economy/v2/catalog";
import { PROPOSED_CHAT, PROPOSED_DEFAULTS } from "../../../src/economy/v2/chat-proposal";
import { baselineParams, PRICED_TIERS, type V2Params } from "../../../src/economy/v2/params";
import { auditJobs } from "./audit-plan";
import { simulateUser, type ResearchTransaction } from "../../../src/economy/v2/sim";
import { gini } from "../../../src/economy/rng";

const dir = resolve(process.argv[2] ?? "docs/economy/v2/codex");
mkdirSync(dir, { recursive: true });
function write(name: string, value: unknown) {
  const path = resolve(dir, name + ".json");
  const temp = path + ".tmp";
  writeFileSync(temp, JSON.stringify(value, null, 1) + "\n");
  renameSync(temp, path);
}
const base = baselineParams();
const legacyBoosters = [base, POLICIES.find((c) => c.id === "V2-BAL")!].flatMap((c) => BOOSTERS.map((b) => ({
  ...c, id: `${c.id}+${b.id}`, label: `${c.label} + ${b.label}`, booster: b.booster,
})));
const chosen = new Map([...SINGLE, ...POLICIES, ...legacyBoosters, ...AUDIT_CANDIDATES, ...INTERACTION, ...auditJobs(false).map((j) => j.params)].map((p) => [p.id, p]));
write("candidates", Object.fromEntries([...chosen].sort(([a], [b]) => a.localeCompare(b))));

const catalogCases: { name: string; revision: 1 | 2; proposedChat?: boolean; policy: V2Params }[] = [
  { name: "Rev1", revision: 1, policy: base },
  { name: "Rev2", revision: 2, policy: base },
  { name: "Confirmed", revision: 2, policy: chosen.get("TIER1")! },
  { name: "ProposedBoard", revision: 2, policy: chosen.get("TIER2")! },
  { name: "ProposedChat", revision: 2, policy: base, proposedChat: true },
  { name: "BothProposals", revision: 2, policy: chosen.get("TIER2")!, proposedChat: true },
  { name: "C1-PRICE", revision: 2, policy: chosen.get("C1-PRICE")! },
  { name: "C1-LOOP", revision: 2, policy: chosen.get("C1-LOOP")! },
];
const allCatalogs = Object.fromEntries(catalogCases.map((c) => {
  const catalog = pricedCatalog(c.policy, { audited: true, ...c }).filter((i) => !i.season);
  const probabilities = drawPools(catalog);
  const items = catalog.map((item) => {
    const tier = item.tier as keyof typeof DRAW_TIER_P;
    const probability = item.drawable ? DRAW_TIER_P[tier] / probabilities[tier].length : 0;
    return { ...item, probability };
  });
  const drawable = items.filter((i) => i.drawable);
  const exposed = Array.from(new Set([0, 0.25, 0.5, 0.75, 0.9, 1])).flatMap((coverage) => {
    const cheap = [...drawable].sort((a, b) => (a.coins ?? 0) - (b.coins ?? 0) || a.id.localeCompare(b.id)).slice(0, Math.floor(drawable.length * coverage));
    const balanced = PRICED_TIERS.flatMap((t) => drawable.filter((i) => i.tier === t).slice(0, Math.floor(probabilities[t].length * coverage)));
    return [{ kind: "cheap-first", items: cheap }, { kind: "tier-balanced", items: balanced }].map(({ kind, items }) => {
      const owned = new Set(items.map((i) => i.id));
      const duplicate = items.reduce((sum, i) => sum + i.probability, 0);
      const unowned = drawable.filter((i) => !owned.has(i.id));
      const draws = [1, 5, 10, 30, 150].map((n) => {
        const newly = unowned.reduce((sum, i) => sum + (1 - (1 - i.probability) ** n), 0);
        const displayedCoins = unowned.reduce((sum, i) => sum + (1 - (1 - i.probability) ** n) * (i.coins ?? 0), 0);
        return { n, newly, displayedCoins, expectedNetCost: n * c.policy.draw.cost - (n - newly) * c.policy.draw.duplicateCoins };
      });
      return { kind, coverage, owned: owned.size, duplicate, draws };
    });
  });
  const sums = {
    paidItems: items.filter((i) => i.coins !== null || i.gems !== null).length,
    coinCatalog: items.reduce((sum, i) => sum + (i.coins ?? 0), 0),
    gemCatalog: items.reduce((sum, i) => sum + (i.gems ?? 0), 0),
    upgrades: items.reduce((sum, i) => sum + (i.up?.[0] ?? 0) + (i.up?.[1] ?? 0), 0),
    drawListValue: drawable.reduce((sum, i) => sum + i.probability * (i.coins ?? 0), 0),
  };
  return [c.name, { sums, byTier: Object.fromEntries(PRICED_TIERS.map((t) => [t, {
    count: probabilities[t].length, p: DRAW_TIER_P[t], pItem: DRAW_TIER_P[t] / probabilities[t].length,
  }])), items, coverage: exposed }];
}));
write("catalog-and-draw", { catalogs: allCatalogs, proposedChats: PROPOSED_CHAT, proposedDefaults: PROPOSED_DEFAULTS });

const policyIds = ["BASE", "V2-CONS", "V2-BAL", "V2-EXP", "C1-SAFE", "C1-PRICE", "C1-QUEST", "C1-LOOP", "C1-LONG", "C1-PRICE-R", "C1-COMBO"];
const limits = Object.fromEntries(policyIds.map((id) => {
  const c = chosen.get(id)!;
  const dailyQuests = c.quests.dailyCoins.reduce((s, x) => s + x, c.quests.dailyAllBonus.coins);
  const weeklyQuests = c.quests.weeklyCoins.reduce((s, x) => s + x, c.quests.weeklyAllBonus.coins);
  const max = (kind: keyof V2Params["match"], quantity: number) =>
    Math.min(quantity, c.daily.fullMatches) * (c.match[kind].complete + c.match[kind].win)
    + Math.max(0, Math.min(quantity, c.daily.reducedUntil) - c.daily.fullMatches) * c.daily.reducedCoins;
  const ai = max("ai", c.daily.aiStarts);
  return [id, {
    random: max("random", c.daily.reducedUntil), minimumDistinctOpponents: Math.ceil(c.daily.reducedUntil / c.daily.sameOpponentRewarded),
    sameOpponent: max("random", c.daily.sameOpponentRewarded),
    friend: max("friend", c.daily.friendRewarded), ai, dailyQuests, weeklyQuests,
    aiGlobalPureMatchCoinsUpper: 100 * (c.match.ai.complete + c.match.ai.win),
    welcomeCoins: c.newUser.coins, newUserFullBandBonus: c.daily.fullMatches * c.newUser.boostPerMatch,
  }];
}));
write("capacity", { source: "worker/wrangler.toml", accountClock: "KST", capacityClock: "UTC", limits });

const after = Object.fromEntries(["C1-PRICE", "C1-PRICE-R", "C1-LOOP", "V2-BAL", "V2-EXP"].map((id) =>
  [id, new Map(pricedCatalog(chosen.get(id)!, { audited: true }).map((i) => [i.id, i]))]));
const original = new Map(pricedCatalog(base, { audited: true }).map((i) => [i.id, i]));
const ledger: { account: number; age: number; min: number; tx: ResearchTransaction[] }[] = [];
for (const [profile, min] of [15, 30, 60, 120, 240].entries()) {
  for (const [ageIndex, age] of [7, 30, 60, 90, 180].entries()) for (let i = 0; i < 12; i++) {
    const tx: ResearchTransaction[] = [];
    const p = persona(min, { activeProb: 0.75, spend: i % 6 === 0 ? "drawer" : i % 6 === 1 ? "upgrader" : "spender" });
    simulateUser(p, base, 791603557, i + 12 * ageIndex + 60 * profile, {
      days: age, audited: true, warmupDays: 0, includeRev2: true, warmupParams: base,
      snapshots: [age], t0: Date.UTC(2026, 10, 29, 15), recordTransaction: (row) => tx.push(row),
    });
    ledger.push({ account: ledger.length, age, min, tx });
  }
}
const reimbursement = Object.fromEntries(Object.entries(after).map(([id, catalog]) => {
  const amounts = ledger.map(({ tx }) => {
    const totals = { purchaseCoinDiff: 0, purchaseGemDiff: 0, upgradeDiff: 0, tradeCount: 0, protectedOwners: 0 };
    const protectedItems = new Set<string>();
    for (const row of tx) {
      const item = catalog.get(row.itemId);
      const old = original.get(row.itemId);
      if (old?.up && item?.up && (item.up[0] > old.up[0] || (item.up[1] ?? 0) > (old.up[1] ?? 0))) protectedItems.add(item.id);
      if (row.kind === "draw" || !item) continue;
      const price = row.kind === "upgrade" ? item.up?.[(row.level ?? 1) - 1] : item[row.currency];
      const diff = price != null ? Math.max(0, row.amount - price) : 0;
      if (row.kind === "upgrade") totals.upgradeDiff += diff;
      else {
        totals.tradeCount++;
        if (row.currency === "coins") totals.purchaseCoinDiff += diff;
        else totals.purchaseGemDiff += diff;
      }
    }
    return { ...totals, protectedOwners: +!!protectedItems.size };
  });
  const total = (f: (x: typeof amounts[number]) => number) => amounts.reduce((s, a) => s + f(a), 0);
  return [id, {
    noPayment: { coins: 0, gems: 0 },
    purchaseQuarter: { coins: total((x) => Math.floor(x.purchaseCoinDiff * 0.25)), gems: total((x) => Math.floor(x.purchaseGemDiff * 0.25)) },
    flat100PerPurchaser: { coins: total((x) => x.tradeCount ? 100 : 0), gems: 0 },
    purchaseUpgradeHalfCapped500: { coins: total((x) => Math.min(500, Math.floor((x.purchaseCoinDiff + x.upgradeDiff) * 0.5))), gems: total((x) => Math.floor(x.purchaseGemDiff * 0.5)) },
    protectedOwners: total((x) => x.protectedOwners),
    grossDiff: { purchaseCoins: total((x) => x.purchaseCoinDiff), purchaseGems: total((x) => x.purchaseGemDiff), upgradeCoins: total((x) => x.upgradeDiff) },
  }];
}));
write("synthetic-ledger", { sample: ledger.length, rows: ledger.reduce((n, a) => n + a.tx.length, 0), policies: reimbursement, ledger });

// A second, explicitly synthetic population including the revised candidate designs at 90 days.
const groups = ["BASE", "V2-BAL", "V2-EXP", "C1-PRICE", "C1-QUEST", "C1-LOOP", "C1-LONG"];
const popResults = Object.fromEntries(groups.map((id) => {
  const c = chosen.get(id)!;
  const all = POPULATION.flatMap((profile) =>
    [0, 60].flatMap((age) =>
      Array.from({ length: Math.max(6, Math.round(profile.share * 150)) }, (_, i) => {
        const p = persona(profile.minutes, { activeProb: profile.activeProb });
        const s = simulateUser(p, c, 278921309, i + age, { days: 90, warmupDays: age, warmupParams: base,
          snapshots: [90], includeRev2: true, audited: true, t0: Date.UTC(2026, 10, 29, 15) }).snapshots[0];
        return { age, minutes: profile.minutes, coins: s.coinsEarned, balance: s.coins, value: s.audit!.ownedValueFixed, net: s.audit!.netCoins };
      }),
    ),
  );
  const coins = all.map((u) => u.coins).sort((a, b) => b - a);
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const mean = (f: (u: typeof all[number]) => number, rows = all) => sum(rows.map(f)) / rows.length;
  return [id, { users: all.length, giniEarned: gini(coins), giniBalance: gini(all.map((u) => u.balance)),
    giniValue: gini(all.map((u) => u.value)), top10: sum(coins.slice(0, Math.ceil(coins.length * 0.1))) / sum(coins),
    bottom50: sum(coins.slice(Math.ceil(coins.length * 0.5))) / sum(coins), avgIssued: mean((u) => u.coins),
    byMinutes: Object.fromEntries(POPULATION.map((p) => {
      const rows = all.filter((u) => u.minutes === p.minutes);
      return [p.minutes, { n: rows.length, coins: mean((u) => u.coins, rows), net: mean((u) => u.net, rows), value: mean((u) => u.value, rows) }];
    })),
  }];
}));
write("population", { seed: 278921309, profiles: POPULATION, results: popResults });

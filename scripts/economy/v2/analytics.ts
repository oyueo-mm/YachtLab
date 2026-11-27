/**
 * Economy v2 closed-form analytics — `npx tsx scripts/economy/v2/analytics.ts`.
 * Exact (no Monte Carlo): price / upgrade / draw-probability effects of the tier re-mapping, draw
 * expected value, theoretical daily maxima per mode, and the cost of "everything" in the catalog.
 * Writes docs/economy/v2/results/analytics.json.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SLOTS } from "../../../src/economy/live/config";
import { DRAW_COST } from "../../../src/economy/live/draw";
import { ITEMS } from "../../../src/economy/live/catalog";
import { CONFIRMED_TIER_MAP, DRAW_TIER_P, PROPOSED_BOARD_MAP, PROPOSED_CHAT_TIERS, drawPools, pricedCatalog, type PricedItem } from "../../../src/economy/v2/catalog";
import { POLICIES } from "../../../src/economy/v2/candidates";
import { baselineParams, PRICED_TIERS, type V2Params } from "../../../src/economy/v2/params";

const base = baselineParams();
const maps: V2Params["tierMap"][] = ["live", "confirmed", "confirmed+proposed"];
const cats = Object.fromEntries(maps.map((m) => [m, pricedCatalog({ ...base, tierMap: m })])) as Record<string, PricedItem[]>;

/* 1. per-item effect of the re-mapping */
const changed = cats["confirmed+proposed"].filter((c) => c.tier !== c.liveTier).map((c) => {
  const live = cats.live.find((x) => x.id === c.id)!;
  const conf = cats.confirmed.find((x) => x.id === c.id)!;
  const name = ITEMS.find((i) => i.id === c.id)!.name;
  return {
    id: c.id, name, category: c.category, status: CONFIRMED_TIER_MAP[c.id] ? "확정" : PROPOSED_BOARD_MAP[c.id] ? "제안" : "",
    from: c.liveTier, to: c.tier,
    coins: [live.coins, c.coins], gems: [live.gems, c.gems],
    fullUpgrade: [live.up ? live.up[0] + live.up[1] : null, c.up ? c.up[0] + c.up[1] : null],
    confirmedOnly: conf.tier !== conf.liveTier,
  };
});

/* 2. draw: per-item probabilities and expected list value per draw */
function drawStats(cat: PricedItem[]) {
  const pools = drawPools(cat);
  const per = Object.fromEntries(PRICED_TIERS.map((t) => [t, { items: pools[t].length, pTier: +DRAW_TIER_P[t].toFixed(6), pItem: pools[t].length ? +(DRAW_TIER_P[t] / pools[t].length).toExponential(4) : 0, meanCoins: Math.round(pools[t].reduce((a, i) => a + (i.coins ?? 0), 0) / Math.max(1, pools[t].length)) }]));
  const ev = PRICED_TIERS.reduce((a, t) => a + DRAW_TIER_P[t] * (per[t] as { meanCoins: number }).meanCoins, 0);
  return { per, expectedListValuePerDraw: Math.round(ev), valuePerCoin: +(ev / DRAW_COST).toFixed(2) };
}
const draws = Object.fromEntries(maps.map((m) => [m, drawStats(cats[m])]));
const itemProbChange = changed.map((c) => {
  const p = (m: string) => {
    const it = cats[m].find((x) => x.id === c.id)!;
    if (!it.drawable || it.season) return 0;
    const pool = drawPools(cats[m])[it.tier as keyof ReturnType<typeof drawPools>];
    return DRAW_TIER_P[it.tier as keyof typeof DRAW_TIER_P] / pool.length;
  };
  return { id: c.id, live: +p("live").toExponential(3), confirmed: +p("confirmed").toExponential(3), proposed: +p("confirmed+proposed").toExponential(3) };
});

/* 3. catalog totals ("everything") */
const totals = (cat: PricedItem[]) => {
  const buy = cat.filter((i) => !i.season && i.coins !== null);
  const coins = buy.reduce((a, i) => a + i.coins!, 0);
  const up = cat.filter((i) => !i.season && i.up).reduce((a, i) => a + i.up![0] + i.up![1], 0);
  const byTier = Object.fromEntries(PRICED_TIERS.map((t) => [t, { n: cat.filter((i) => i.tier === t && !i.season).length, coins: cat.filter((i) => i.tier === t && !i.season && i.coins !== null).reduce((a, i) => a + i.coins!, 0) }]));
  return { coinItems: buy.length, coins, upgrades: up, all: coins + up, byTier };
};
const catalogTotals = Object.fromEntries([...maps.map((m) => [m, totals(cats[m])]), ...POLICIES.map((p) => [p.id, totals(pricedCatalog(p))])]);

/* 4. chat proposal: value of 38 lines at the live chat price ratio (55 % for plain lines) */
const chatRatio = 0.55;
const chatProposal = Object.fromEntries(PRICED_TIERS.map((t) => [t, { lines: PROPOSED_CHAT_TIERS[t], unitCoins: Math.floor((base.priceMult[t] * ({ common: 300, rare: 1000, epic: 3000, legendary: 10000, mythic: 25000 }[t]) * chatRatio) / 5) * 5 }]));
const liveChat = cats.live.filter((i) => i.category === "chat" && i.coins !== null && !i.season);
const chatTotals = { liveLines: liveChat.length, liveCoins: liveChat.reduce((a, i) => a + i.coins!, 0), proposedLines: 38, proposedCoins: PRICED_TIERS.reduce((a, t) => a + chatProposal[t].lines * chatProposal[t].unitCoins, 0) };

/* 5. theoretical maxima per day (coins), baseline and policies */
function dailyMax(p: V2Params) {
  const m = (k: keyof V2Params["match"]) => p.match[k].complete + p.match[k].win;
  const reduced = (p.daily.reducedUntil - p.daily.fullMatches) * p.daily.reducedCoins;
  const quests = p.quests.dailyCoins.reduce((a, b) => a + b, 0) + p.quests.dailyAllBonus.coins;
  return {
    random: p.daily.fullMatches * m("random") + reduced + quests,
    ai: p.daily.fullMatches * m("ai") + reduced + quests,
    friend: Math.min(p.daily.friendRewarded, p.daily.fullMatches) * p.match.friend.complete + quests,
    newUserBoost: p.daily.fullMatches * p.newUser.boostPerMatch,
    weeklyQuests: p.quests.weeklyCoins.reduce((a, b) => a + b, 0) + p.quests.weeklyAllBonus.coins,
  };
}
const maxima = Object.fromEntries([base, ...POLICIES].map((p) => [p.id, dailyMax(p)]));

const out = { generatedBy: "scripts/economy/v2/analytics.ts", changed, itemProbChange, draws, catalogTotals, chatProposal, chatTotals, maxima, slots: SLOTS.prices };
const dir = fileURLToPath(new URL("../../../docs/economy/v2/results/", import.meta.url));
mkdirSync(dir, { recursive: true });
writeFileSync(dir + "analytics.json", JSON.stringify(out, null, 1));
console.log(JSON.stringify({ changed, draws, catalogTotals, chatTotals, maxima }, null, 1));

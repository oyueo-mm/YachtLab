import { categories, total, type Card } from "../../src/engine";
import { eventProbability, type TierId } from "../../src/economy/content";
import { hashSeed, mulberry32 } from "../../src/economy/rng";
import { itemById, priceOf, upgradeCost } from "../../src/economy/live/catalog";
import { ECONOMY, economyDay, economyWeek } from "../../src/economy/live/config";
import { DRAW_COST, DRAW_DAILY_LIMIT, DRAW_TIERS, DUPLICATE_COINS, HANDS, drawHand, drawItems, enumerateDrawHands } from "../../src/economy/live/draw";
import { applyMatch, newEconState, replaceQuests, type Grant } from "../../src/economy/live/rewards";

const start = Date.parse("2026-12-01T00:00:00+09:00");
const day = 86_400_000;
const players = 500;
const days = 30;
const scenarios = [
  { skill: "beginner", perDay: 2, activeDays: 3 },
  { skill: "intermediate", perDay: 5, activeDays: 5 },
  { skill: "intermediate", perDay: 12, activeDays: 7 },
] as const satisfies readonly { skill: TierId; perDay: number; activeDays: number }[];
const roster = {
  standard: Object.fromEntries(DRAW_TIERS.map((tier) => [tier, drawItems("standard", tier)])),
  holiday: Object.fromEntries(DRAW_TIERS.map((tier) => [tier, drawItems("christmas-2026", tier)])),
};
const outcomes = ["match", "quest", "quest-bonus", "achievement", "welcome"] as const satisfies readonly Grant["kind"][];

function simulate(scenario: typeof scenarios[number], index: number, strategy: "save" | "draw" | "buy-and-upgrade") {
  const userId = `sim-${index}`;
  const random = mulberry32(hashSeed(112626, scenario.skill + "-" + scenario.perDay, index));
  const drawRandom = mulberry32(hashSeed(112626, "draw-" + scenario.perDay, index));
  let state = newEconState(userId, start);
  let coins: number = ECONOMY.newUser.coins;
  let gems: number = ECONOMY.newUser.gems;
  let drawSpent = 0, duplicatePaid = 0, duplicates = 0, draws = 0, upgrades = 0;
  let itemCost = 0;
  const grants = Object.fromEntries(outcomes.map((kind) => [kind, kind === "welcome" ? coins : 0]));
  const owned = new Set<string>();
  const focus = itemById("dice.ruby")!;
  const focusPrice = priceOf(focus, "coins")!;
  const rate = (event: "fullScored" | "smallScored" | "largeScored" | "yachtScored" | "fourScored") =>
    eventProbability(scenario.skill, event);
  for (let d = 0; d < days; d++) {
    if (d % 7 >= scenario.activeDays) continue;
    const now = start + d * day + 12 * 3600_000;
    for (let m = 0; m < scenario.perDay; m++) {
      const card = Object.fromEntries(categories.map((category, i) => [category, i < 6 ? Math.floor(random() * 5) * (i + 1) : 0])) as Card;
      card.choice = 15 + Math.floor(random() * 13);
      card.four = random() < rate("fourScored") ? 24 : 0;
      card.full = random() < rate("fullScored") ? 20 : 0;
      card.small = random() < rate("smallScored") ? 15 : 0;
      card.large = random() < rate("largeScored") ? 30 : 0;
      card.yacht = random() < rate("yachtScored") ? 50 : 0;
      const result = applyMatch(state, {
        matchId: `m-${d}-${m}`, kind: "random", outcome: random() < 0.5 ? "win" : "loss", endReason: "completed",
        score: total(card), card, endedAt: now + m * 1000,
      }, { userId, createdAt: start });
      state = result.state;
      for (const grant of result.grants) {
        grants[grant.kind] = (grants[grant.kind] ?? 0) + grant.coins;
        coins += grant.coins;
        gems += grant.gems;
      }
    }
    if (d % 7 === scenario.activeDays - 2) {
      const next = replaceQuests(state, userId, "weekly", economyWeek(now), "all");
      if (next.ok) state = next.state;
    }
    if (scenario.perDay >= 5 && !state.daily[2].done && state.daily[2].progress === 0) {
      const next = replaceQuests(state, userId, "daily", economyDay(now), "all");
      if (next.ok) state = next.state;
    }
    if (strategy === "draw") {
      for (let n = 0; n < DRAW_DAILY_LIMIT && coins >= DRAW_COST; n++) {
        const hand = drawHand(Array.from({ length: 5 }, () => 1 + Math.floor(drawRandom() * 6)));
        const items = roster.standard[HANDS[hand].tier];
        const item = items[Math.floor(drawRandom() * items.length)];
        coins -= DRAW_COST;
        draws++;
        drawSpent += DRAW_COST;
        if (owned.has(item.id)) {
          coins += DUPLICATE_COINS;
          duplicatePaid += DUPLICATE_COINS;
          duplicates++;
        }
        owned.add(item.id);
      }
    }
    if (strategy === "buy-and-upgrade") {
      if (!owned.has(focus.id) && coins >= focusPrice) {
        owned.add(focus.id);
        coins -= focusPrice;
        itemCost += focusPrice;
      }
      const upgrade = upgradeCost(focus, upgrades + 1);
      if (owned.has(focus.id) && upgrade !== null && coins >= upgrade) {
        coins -= upgrade;
        itemCost += upgrade;
        upgrades++;
      }
    }
  }
  return { coins, gems, draws, duplicates, drawSpent, duplicatePaid, owned: owned.size, upgrades, itemCost, ...grants };
}
console.log(JSON.stringify({
  seed: 112626,
  usersPerScenario: players,
  days,
  hands: enumerateDrawHands(),
  pools: Object.fromEntries(Object.entries(roster).map(([pool, items]) => [pool, Object.fromEntries(DRAW_TIERS.map((tier) => [tier, items[tier].length]))])),
  scenarios: scenarios.flatMap((scenario) => (["save", "draw", "buy-and-upgrade"] as const).map((strategy) => {
    const samples = Array.from({ length: players }, (_, index) => simulate(scenario, index, strategy));
    const average = Object.fromEntries(Object.keys(samples[0]).map((field) => {
      const key = field as keyof typeof samples[0];
      return [key, Number((samples.reduce((sum, sample) => sum + sample[key], 0) / players).toFixed(2))];
    }));
    return { ...scenario, strategy, average };
  })),
}, null, 2));

/** Rebuild the independent evaluation table and Pareto data from H1's paired simulation rows. */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { survivalTimes } from "./survival";
import { AUDIT_CANDIDATES, POLICIES } from "../../../src/economy/v2/candidates";
import { baselineParams } from "../../../src/economy/v2/params";
import { FINALISTS, HOLDOUT } from "./audit-plan";

type Sample = {
  direct: number | null; any: number | null; censor: number; coin: number; net: number; balance: number;
  desired30: boolean; buy7: boolean; any7: boolean; buy30: boolean; lv3: boolean; owned: number; lateGap30: boolean; fixedValue: number;
};
const dir = process.argv[2];
if (!dir) throw new Error("Usage: tsx scripts/economy/v2/audit-summary.ts <H1 output directory>");
const samples = JSON.parse(gunzipSync(readFileSync(resolve(dir, "H1-samples.json.gz"))).toString()) as Record<string, Sample[]>;
const names = ["new30", "existing60", "light15", "heavy240"];
const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;
function paired(blocks: number[][]) {
  const means = blocks.map(mean);
  const overall = mean(means);
  // The four simulation seed-block means are independent. t(.975,3) = 3.182.
  const half = 3.182 * Math.sqrt(means.reduce((s, x) => s + (x - overall) ** 2, 0) / (means.length * (means.length - 1)));
  return { mean: overall, lo: overall - half, hi: overall + half, seeds: means };
}
const compareKeys = ["any7", "buy30", "desired30", "lv3", "coin", "net", "owned", "fixedValue", "balance", "lateGap30"] as const;
const lookup = (c: string, p: string, s: number) => {
  const key = Object.keys(samples).find((k) => k.startsWith(`${c}|${p}|`) && k.endsWith(`|s${s}`));
  if (!key || samples[key].length !== 48) throw new Error(`Missing pre-registered H1 cell ${c} ${p} ${s}`);
  return samples[key];
};
const cohorts = Object.fromEntries(names.map((p) => {
  const base = HOLDOUT.map((seed) => lookup("BASE", p, seed));
  return [p, Object.fromEntries(FINALISTS.map((c) => {
    const blocks = HOLDOUT.map((seed) => lookup(c, p, seed));
    const metrics = Object.fromEntries(compareKeys.map((k) => {
      const absolute = blocks.map((rows) => rows.map((r) => +r[k]));
      const delta = blocks.map((rows, index) => rows.map((row, i) => +row[k] - +base[index][i][k]));
      return [k, { mean: mean(absolute.flat()), delta: paired(delta) }];
    }));
    const med = (k: "direct" | "any") => survivalTimes(blocks.flat().map((x) => ({ event: x[k], censor: x.censor })));
    return [c, {
      n: blocks.flat().length, metrics, firstDirect: med("direct"), firstAny: med("any"),
      firstDirectBySeed: blocks.map((rs) => survivalTimes(rs.map((x) => ({ event: x.direct, censor: x.censor })))),
    }];
  }))];
}));
const basePolicy = baselineParams();
const config = new Map([basePolicy, ...POLICIES, ...AUDIT_CANDIDATES].map((p) => [p.id, p]));
const levers = ["match", "daily", "newUser", "quests", "achievementMult", "priceMult", "draw", "streakWeekly", "collectionReward", "starter", "booster", "tierMap"] as const;
function changedGroups(id: string) {
  const c = config.get(id)!;
  const count = levers.filter((key) => JSON.stringify(c[key]) !== JSON.stringify(basePolicy[key])).length;
  return count + Number(JSON.stringify(c.upgradeMult) !== JSON.stringify(basePolicy.upgradeMult) || !!c.secondUpgradeMult);
}
const objectives = Object.fromEntries(FINALISTS.map((c) => [c, {
  new7: cohorts.new30[c].metrics.any7.mean,
  old30: cohorts.existing60[c].metrics.buy30.mean,
  desired30: cohorts.existing60[c].metrics.desired30.mean,
  light30: cohorts.light15[c].metrics.buy30.mean,
  issue90: mean(names.map((name) => cohorts[name][c].metrics.coin.mean)),
  existingDirectMedian: cohorts.existing60[c].firstDirect.median ?? Number.MAX_VALUE,
  changedGroups: changedGroups(c),
  newOwned90: cohorts.new30[c].metrics.owned.mean,
  newLv3: cohorts.new30[c].metrics.lv3.mean,
  lateOldGap: cohorts.existing60[c].metrics.lateGap30.mean,
}]));
const directions = { new7: 1, old30: 1, desired30: 1, light30: 1, issue90: -1, newOwned90: -1, newLv3: 1, lateOldGap: -1, existingDirectMedian: -1, changedGroups: -1 } as const;
type Axis = keyof typeof directions;
function frontier(axes: Axis[]) {
  const val = (id: string, k: Axis) => objectives[id][k] * directions[k];
  return FINALISTS.filter((c) => !FINALISTS.some((other) =>
    axes.every((k) => val(other, k) >= val(c, k)) && axes.some((k) => val(other, k) > val(c, k))));
}
const axes = ["new7", "old30", "desired30", "light30", "issue90"] as const;
const output = {
  seeds: HOLDOUT, cohorts, objectives,
  pareto: {
    main: frontier([...axes]),
    addLv3AndRetention: frontier([...axes, "newLv3", "lateOldGap"]),
    addContentBurn: frontier([...axes, "newOwned90"]),
    addLatencyAndChangedGroups: frontier([...axes, "existingDirectMedian", "changedGroups"]),
    addChangedGroups: frontier([...axes, "changedGroups"]),
    existingDesiredVersusIssue: frontier(["desired30", "issue90"]),
    lightAccessVersusIssue: frontier(["light30", "issue90"]),
  },
};
writeFileSync(resolve(dir, "summary.json"), JSON.stringify(output, null, 1) + "\n");

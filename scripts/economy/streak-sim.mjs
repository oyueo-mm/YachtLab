#!/usr/bin/env node
/**
 * Win-streak reward options (Phase 10 review, 2026-11-27). Monte Carlo, deterministic seed. NOTHING here
 * is active: it compares designs against the live economy numbers (src/economy/live/config.ts M3i-W30@2:
 * quick match = 10 complete + 3 win coins, first 10 matches a day at full reward).
 *
 * Model: 20,000 players, skill s ~ N(0, 1). Quick match pairs random opponents (no rating MM yet).
 * Yacht Dice is luck-heavy: P(win) = 0.5 + 0.12·tanh((s_a − s_b)/1.5) (≈ 38–62 % between the 2nd and
 * 98th percentile; measured DP-Expert-vs-casual gaps are of this order). Draws ~0.6 % (counted as
 * a streak break here, see options). 10 rewarded matches/day, 28 days.
 *
 *   node scripts/economy/streak-sim.mjs [--json out.json]
 */
import { writeFileSync } from "node:fs";

let seed = 20261127;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const gauss = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
const N = 20000, DAYS = 28, PER_DAY = 10;
const pWin = (a, b) => 0.5 + 0.12 * Math.tanh((a - b) / 1.5);

const OPTIONS = {
  A_none: { label: "A. 보상 없음(현행: 5·10연승 업적만)", pay: () => 0 },
  B_ladder: { label: "B. 연승 단계 보너스 +2/+4/+6(3·4·5연승 이상, 경기당)", pay: (k) => (k >= 5 ? 6 : k === 4 ? 4 : k === 3 ? 2 : 0) },
  C_milestone: { label: "C. 이정표 1회 지급 3연승 10·5연승 20·10연승 40 (하루 1회씩)", pay: (k, day) => (day.ms[k] ? 0 : ((day.ms[k] = 1), k === 3 ? 10 : k === 5 ? 20 : k === 10 ? 40 : 0)) },
  D_weekly: { label: "D. 주간 최고 연승 단계 보상(주 1회, 3→15 · 5→30 · 8→50)", pay: () => 0, weekly: (best) => (best >= 8 ? 50 : best >= 5 ? 30 : best >= 3 ? 15 : 0) },
};

const skill = Array.from({ length: N }, gauss);
const order = skill.map((s, i) => [s, i]).sort((a, b) => a[0] - b[0]).map(([, i]) => i);
const pct = new Float64Array(N);
order.forEach((i, r) => (pct[i] = r / (N - 1)));

const result = {};
for (const [key, opt] of Object.entries(OPTIONS)) {
  const coins = new Float64Array(N), base = new Float64Array(N), best = new Uint16Array(N), broken3 = new Uint32Array(N), reached3 = new Uint32Array(N);
  for (let i = 0; i < N; i++) {
    let streak = 0, weekBest = 0;
    for (let d = 0; d < DAYS; d++) {
      const day = { ms: {} };
      for (let m = 0; m < PER_DAY; m++) {
        const opp = skill[(rnd() * N) | 0];
        const r = rnd();
        const draw = r < 0.006;
        const win = !draw && r < 0.006 + (1 - 0.006) * pWin(skill[i], opp);
        base[i] += 10 + (win ? 3 : draw ? 2 : 0);
        if (win) {
          streak++;
          if (streak === 3) reached3[i]++;
          coins[i] += opt.pay(streak, day);
        } else {
          if (streak >= 3) broken3[i]++;
          streak = 0;
        }
        if (streak > best[i]) best[i] = streak;
        if (streak > weekBest) weekBest = streak;
      }
      if ((d + 1) % 7 === 0) {
        if (opt.weekly) coins[i] += opt.weekly(weekBest);
        weekBest = streak;
      }
    }
  }
  const band = (lo, hi) => {
    const ids = [...Array(N).keys()].filter((i) => pct[i] >= lo && pct[i] < hi);
    const avg = (arr) => ids.reduce((a, i) => a + arr[i], 0) / ids.length;
    return { extraPerDay: +(avg(coins) / DAYS).toFixed(2), basePerDay: +(avg(base) / DAYS).toFixed(1), bestStreak: +avg(best).toFixed(1) };
  };
  const total = coins.reduce((a, b) => a + b, 0) || 1;
  const top10 = [...Array(N).keys()].filter((i) => pct[i] >= 0.9).reduce((a, i) => a + coins[i], 0) / total;
  const bottom50 = [...Array(N).keys()].filter((i) => pct[i] < 0.5).reduce((a, i) => a + coins[i], 0) / total;
  result[key] = {
    label: opt.label,
    bottom25: band(0, 0.25), median: band(0.4, 0.6), top10: band(0.9, 1.01),
    shareTop10: +(top10 * 100).toFixed(1), shareBottom50: +(bottom50 * 100).toFixed(1),
    extraVsBasePct: +((total / base.reduce((a, b) => a + b, 0)) * 100).toFixed(1),
    // frustration proxy: streaks of 3+ that ended in a loss, per player per week
    broken3PerWeek: +([...broken3].reduce((a, b) => a + b, 0) / N / (DAYS / 7)).toFixed(2),
  };
}
const out = process.argv.indexOf("--json");
if (out > 0) writeFileSync(process.argv[out + 1], JSON.stringify(result, null, 2));
for (const [k, r] of Object.entries(result)) {
  console.log(`\n${r.label}`);
  console.table({ "하위 25%": r.bottom25, "중위 40~60%": r.median, "상위 10%": r.top10 });
  console.log(`  추가 코인 = 기본 경기 보상의 ${r.extraVsBasePct}% · 상위 10% 몫 ${r.shareTop10}% · 하위 50% 몫 ${r.shareBottom50}% · 3연승 이상이 깨진 횟수/주 ${r.broken3PerWeek}`);
}

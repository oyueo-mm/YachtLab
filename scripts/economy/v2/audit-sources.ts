/** Itemized sources for E9 and a same-session-length booster traffic comparison. */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { AUDIT_CANDIDATES, BOOSTERS, SENSITIVITY, persona } from "../../../src/economy/v2/candidates";
import { baselineParams } from "../../../src/economy/v2/params";
import { simulateUser } from "../../../src/economy/v2/sim";
const dir = resolve(process.argv[2] ?? "docs/economy/v2/codex");
mkdirSync(dir, { recursive: true });
const base = baselineParams();
const sourceStudy = ["default", "lowTraffic"].map((id) => {
  const variant = SENSITIVITY.find((s) => s.id === id)!;
  const label = `t240-${id}`;
  const count = 200;
  const coins: Record<string, number> = {};
  for (let i = 0; i < count; i++) {
    simulateUser(persona(240, { ...variant.patch, startHour: 19 }, label), base, 630736503, i, {
      days: 1, warmupDays: 60, warmupParams: base, audited: true, includeRev2: true, snapshots: [1],
      t0: Date.UTC(2026, 11, 2, 15),
      recordGrant(g) {
        const [key, period] = g.key.split(":");
        const group = key === "a" ? g.key : key === "q" || key === "qb" ? `quests:${period}` : g.kind;
        coins[group] = (coins[group] ?? 0) + g.coins;
      },
    });
  }
  return [id, { count, perUser: Object.fromEntries(Object.entries(coins).map(([k, v]) => [k, v / count])) }];
});
const price = AUDIT_CANDIDATES.find((c) => c.id === "C1-PRICE")!;
const approaches = ["none", "time10x2", "time30x2", "time60x2", "match3x2", "auto3x2", "extra60", "event"];
const matched = Object.fromEntries(approaches.map((id) => {
  const booster = BOOSTERS.find((b) => b.id === id)!.booster;
  return [id, Object.fromEntries([false, true].map((traffic) => {
    const p = persona(30, traffic ? { queueSuccess: 0.35, queue: { meanWaitSec: 300, patienceSec: 180, fallback: "offline" } } : {});
    const n = 100;
    let issued = 0, grants = 0, used = 0, benefitDays = 0, sessions = 0, wait = 0;
    for (let i = 0; i < n; i++) {
      const s = simulateUser(p, { ...price, booster }, 492035442, i, {
        days: 30, warmupDays: 0, warmupParams: base, audited: true, includeRev2: true,
        snapshots: [30], t0: Date.UTC(2026, 10, 29, 15),
      }).snapshots[0];
      issued += s.boostCoins;
      grants += s.boosterMinutesGranted;
      used += s.boosterMinutesUsed;
      benefitDays += s.audit!.boostedSessions;
      sessions += s.activeDays;
      wait += s.audit!.waitMin;
    }
    return [traffic ? "low" : "normal", { n, extraCoins: issued / n, minuteUtilization: grants ? used / grants : null, sessionUtilization: benefitDays / sessions, queueMinutes: wait / n }];
  }))];
}));
writeFileSync(resolve(dir, "sources-and-booster-traffic.json"), JSON.stringify({
  perUserSources: Object.fromEntries(sourceStudy),
  matchedBoosterTraffic: { seed: 492035442, minutes: 30, age: 0, comparison: matched },
}, null, 1) + "\n");

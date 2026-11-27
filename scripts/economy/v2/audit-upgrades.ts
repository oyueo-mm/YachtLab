/** Evaluate the first Lv.2 / Lv.3 and whether the next direct purchase follows. */
import { writeFileSync } from "node:fs";
import { AUDIT_CANDIDATES, persona } from "../../../src/economy/v2/candidates";
import { baselineParams } from "../../../src/economy/v2/params";
import { simulateUser, type ResearchTransaction } from "../../../src/economy/v2/sim";
import { survivalTimes } from "./survival";

const base = baselineParams();
const duration = 90;
const n = 80;
const seed = 873204727;
const cohort = {
  "new-favorite": { p: persona(30), age: 0 },
  "new-upgrader": { p: persona(30, { spend: "upgrader", interest: "looks", drawAppetite: 0 }), age: 0 },
  "existing-upgrader": { p: persona(60, { spend: "upgrader", interest: "looks", drawAppetite: 0 }), age: 60 },
};
const cells = Object.fromEntries(Object.entries(cohort).map(([id, { p, age }]) => [id,
  Object.fromEntries([base, ...AUDIT_CANDIDATES.filter((c) => ["C1-PRICE", "C1-LOOP"].includes(c.id))].map((c) => {
    const rows = Array.from({ length: n }, (_, i) => {
      const tx: ResearchTransaction[] = [];
      const r = simulateUser(p, c, seed, i, {
        days: duration, warmupDays: age, includeRev2: true, audited: true, warmupParams: base,
        snapshots: [duration], t0: Date.UTC(2026, 10, 29, 15),
        recordTransaction(t) { if (t.day >= 0 && t.day < duration) tx.push(t); },
      });
      const snapshot = r.snapshots[0];
      const level3Index = tx.findIndex((t) => t.kind === "upgrade" && t.level === 2);
      const level3 = level3Index < 0 ? null : tx[level3Index].day;
      const buy = level3 === null ? undefined : tx.slice(level3Index + 1).find((t) => t.kind === "buy");
      return { level2: snapshot.audit!.firstLevel2Day, level3, wait: buy && level3 !== null ? buy.day - level3 : null };
    });
    const observed = rows.filter((r) => r.level3 !== null);
    const time = (key: "level2" | "level3") => survivalTimes(rows.map((x) =>
      ({ event: x[key] !== null && x[key]! < duration ? x[key] : null, censor: duration })));
    return [c.id, { lv2: time("level2"), lv3: time("level3"), subsequentBuy: survivalTimes(observed.map((r) =>
      ({ event: r.wait, censor: duration - r.level3! }))), level3Sample: observed.length }];
  })),
]));
writeFileSync(process.argv[2] ?? "docs/economy/v2/codex/upgrade-progression.json", JSON.stringify({ seed, duration, n, cells }, null, 1) + "\n");

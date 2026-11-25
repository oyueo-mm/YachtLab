// Cached exact PMF banks of the v6 exponential-utility policy family.
// Files live under training/checkpoints/v6/ (git-ignored, ~300 MB each as Float64).
//   npx tsx scripts/research-v6/banks.ts build -0.04 0.04   # build (and cache) banks
import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { RiskPolicy, buildRiskBank } from "../../src/research-v6/risk.ts";
import { serializeBank, loadBankFile, loadDPExpertBank } from "../research-v5/bank-io.ts";
import type { PolicyPmfBank } from "../../src/research-v5/policy-pmf.ts";

export const DEFAULT_LAMBDAS = [-0.08, -0.04, -0.02, 0, 0.02, 0.04, 0.08];
const dir = new URL("../../training/checkpoints/v6/", import.meta.url);
const nameOf = (lam: number) => (lam === 0 ? "DP Expert" : `exp(${lam})`);
const cache = new Map<number, PolicyPmfBank>();

export function loadRiskBank(lam: number, log = true): PolicyPmfBank {
  const hit = cache.get(lam);
  if (hit) return hit;
  let bank: PolicyPmfBank;
  if (lam === 0) bank = loadDPExpertBank(log).bank; // bit-identical (tests/research-v6.test.ts)
  else {
    const file = new URL(`risk_${lam}.f64bank`, dir);
    if (existsSync(file)) bank = loadBankFile(file, () => NaN);
    else {
      const t0 = performance.now();
      const pol = new RiskPolicy(lam).build();
      bank = buildRiskBank(pol, nameOf(lam));
      if (log) console.error(`[v6] built risk bank lambda=${lam} in ${((performance.now() - t0) / 1000).toFixed(1)}s`, bank.stats);
      mkdirSync(dir, { recursive: true });
      writeFileSync(file, serializeBank(bank));
    }
  }
  Object.defineProperty(bank, "name", { value: nameOf(lam) });
  cache.set(lam, bank);
  return bank;
}
export const loadRiskBanks = (lams: number[]) => lams.map((l) => loadRiskBank(l));

if (process.argv[2] === "build") for (const a of process.argv.slice(3)) if (a !== "--") loadRiskBank(Number(a));

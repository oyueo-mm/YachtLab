// Peak RSS of loading the DP Expert bank: legacy (readFileSync + copy) vs single-copy loader.
//   V5_LEGACY_LOADER=1 npx tsx scripts/research-v6/loader-rss.ts ; npx tsx scripts/research-v6/loader-rss.ts
import { readFileSync } from "node:fs";
import { loadDPExpertBank } from "../research-v5/bank-io.ts";
const t0 = performance.now();
const { bank } = loadDPExpertBank(false);
const ms = performance.now() - t0;
const hwm = /VmHWM:\s+(\d+)/.exec(readFileSync("/proc/self/status", "utf8"))![1];
console.log(JSON.stringify({ loader: process.env.V5_LEGACY_LOADER ? "legacy" : "single-copy", loadMs: Math.round(ms), peakRssMB: Math.round(Number(hwm) / 1024), initialMean: bank.mean[4095 * 64] }));

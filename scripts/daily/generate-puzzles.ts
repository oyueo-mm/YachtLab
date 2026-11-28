/**
 * Offline generation of the daily strategy puzzle bank (LIVE-1).
 *   npx tsx scripts/daily/generate-puzzles.ts [--days 84] [--seed 20261201] [--check]
 * Writes src/daily/puzzles/bank.json (imported by the Worker only — never by the web bundle).
 * --check regenerates and fails when the committed bank differs (reproducibility check).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import manifest from "../../src/dp-manifest.json";
import { setDPTable } from "../../src/dp";
import { bankStats, buildBank, DEFAULT_OPTIONS } from "../../src/daily/puzzles/generate";

const arg = (name: string) => {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const bytes = gunzipSync(readFileSync(`public/ai/${manifest.asset}`));
if (createHash("sha256").update(bytes).digest("hex") !== manifest.sha256) throw Error("DP table hash mismatch");
setDPTable(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
const options = { ...DEFAULT_OPTIONS, ...(arg("days") ? { days: Number(arg("days")) } : {}), ...(arg("seed") ? { seed: Number(arg("seed")) } : {}) };
const started = performance.now();
const bank = buildBank(options);
const text = JSON.stringify(bank) + "\n";
const path = "src/daily/puzzles/bank.json";
const seconds = ((performance.now() - started) / 1000).toFixed(1);
if (process.argv.includes("--check")) {
  const same = readFileSync(path, "utf8") === text;
  console.log(JSON.stringify({ reproducible: same, seconds }));
  if (!same) process.exit(1);
} else {
  writeFileSync(path, text);
  console.log(JSON.stringify({ ...bankStats(bank), bytes: text.length, seconds }, null, 1));
}

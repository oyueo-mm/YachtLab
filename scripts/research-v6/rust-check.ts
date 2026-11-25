// Dump kernel tables for the Rust builder and compare its bank with the TS bank bit for bit.
//   npx tsx scripts/research-v6/rust-check.ts dump OUT.bin ; npx tsx scripts/research-v6/rust-check.ts compare BANK
import { writeFileSync } from "node:fs";
import { POINTS, PROB, CHILD, HOLD_START, HOLD_LIST, canonicalUpper } from "../../src/research-v5/kernel.ts";
import { loadDPExpertBank, loadBankFile } from "../research-v5/bank-io.ts";
const [cmd, path] = process.argv.slice(2);
if (cmd === "dump") {
  const parts = [Int32Array.of(HOLD_LIST.length), POINTS, PROB, CHILD, HOLD_START, HOLD_LIST].map((a) => Buffer.from(a.buffer, a.byteOffset, a.byteLength));
  writeFileSync(path, Buffer.concat(parts));
} else {
  const { bank } = loadDPExpertBank(false), r = loadBankFile(path, () => NaN);
  let diff = 0, n = 0;
  for (let m = 0; m < 4096; m++) for (let u = 0; u < 64; u++) { if (canonicalUpper(m, u) !== u) continue; n++; const a = bank.pmf[m * 64 + u]!, b = r.pmf[m * 64 + u]!; if (a.length !== b.length || a.some((x, i) => x !== b[i])) diff++; }
  console.log(JSON.stringify({ states: n, statesNotBitIdentical: diff }));
}

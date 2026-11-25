import { Buffer } from "node:buffer";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { PolicyPmfBank, type ContinuationValue } from "../../src/research-v5/policy-pmf.ts";
import { canonicalUpper } from "../../src/research-v5/kernel.ts";
import { loadDPTable } from "./load-dp.ts";

/** Binary serialisation: header JSON line + Float64 payload (canonical states only). */
export function serializeBank(bank: PolicyPmfBank): Buffer {
  const keys: number[] = [], lens: number[] = [];
  let floats = 0;
  for (let mask = 0; mask < 4096; mask++) for (let u = 0; u < 64; u++) {
    if (canonicalUpper(mask, u) !== u) continue;
    const p = bank.pmf[mask * 64 + u];
    if (!p) continue;
    keys.push(mask * 64 + u); lens.push(p.length); floats += p.length;
  }
  const payload = new Float64Array(floats);
  let o = 0;
  for (const k of keys) { const p = bank.pmf[k]!; payload.set(p, o); o += p.length; }
  const header = Buffer.from(JSON.stringify({ format: "yachtlab-policy-pmf-1", name: bank.name, states: keys.length, floats }) + "\n");
  const idx = new Int32Array(keys.length * 2);
  keys.forEach((k, i) => { idx[2 * i] = k; idx[2 * i + 1] = lens[i]; });
  return Buffer.concat([header, Buffer.from(idx.buffer), Buffer.from(payload.buffer)]);
}
export function deserializeBank(buf: Buffer, W: ContinuationValue): PolicyPmfBank {
  const nl = buf.indexOf(10);
  const header = JSON.parse(buf.subarray(0, nl).toString());
  if (header.format !== "yachtlab-policy-pmf-1") throw Error("bad PMF bank format");
  const bank = new PolicyPmfBank(header.name, W);
  const ab = new ArrayBuffer(buf.length - nl - 1);
  new Uint8Array(ab).set(buf.subarray(nl + 1));
  const idx = new Int32Array(ab, 0, header.states * 2);
  const payload = new Float64Array(ab, header.states * 8, header.floats);
  let o = 0;
  for (let i = 0; i < header.states; i++) {
    const k = idx[2 * i], len = idx[2 * i + 1];
    const p = payload.subarray(o, o + len); o += len;
    bank.pmf[k] = p;
    let mu = 0; for (let g = 0; g < len; g++) mu += g * p[g];
    bank.mean[k] = mu;
  }
  for (let mask = 0; mask < 4096; mask++) for (let u = 0; u < 64; u++) {
    const cu = canonicalUpper(mask, u);
    if (cu !== u) { bank.pmf[mask * 64 + u] = bank.pmf[mask * 64 + cu]; bank.mean[mask * 64 + u] = bank.mean[mask * 64 + cu]; }
  }
  return bank;
}

/** DP Expert PMF bank, cached under training/checkpoints (git-ignored). */
export function loadDPExpertBank(log = true) {
  const T = loadDPTable();
  const W = (m: number, u: number) => T[m * 64 + u];
  const dir = new URL("../../training/checkpoints/v5/", import.meta.url);
  const file = new URL("dp-expert-pmf.f64bank", dir);
  if (existsSync(file)) {
    const t0 = performance.now();
    const bank = deserializeBank(readFileSync(file), W);
    if (log) console.error(`[v5] loaded PMF bank ${((performance.now() - t0) / 1000).toFixed(1)}s`);
    return { bank, T };
  }
  const bank = new PolicyPmfBank("DP Expert", W).build();
  if (log) console.error(`[v5] built PMF bank`, bank.stats);
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, serializeBank(bank));
  return { bank, T };
}

/** Any W-greedy policy bank, cached by name. */
export function loadPolicyBank(name: string, W: ContinuationValue, log = true) {
  const dir = new URL("../../training/checkpoints/v5/", import.meta.url);
  const file = new URL(name.replace(/[^a-z0-9-]/gi, "_") + "-pmf.f64bank", dir);
  if (existsSync(file)) return deserializeBank(readFileSync(file), W);
  const bank = new PolicyPmfBank(name, W).build();
  if (log) console.error(`[v5] built PMF bank ${name}`, bank.stats);
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, serializeBank(bank));
  return bank;
}

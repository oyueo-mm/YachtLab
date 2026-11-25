import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import manifest from "../src/dp-manifest.json";
import { PolicyPmfBank } from "../src/research-v5/policy-pmf";
import { popcount } from "../src/research-v5/kernel";
import { buildBankWasm, bankFromWasm } from "../src/research-v6/wasm-pmf";
import { encodeBank, decodeBank } from "../src/research-v6/bank-codec";

const buf = gunzipSync(readFileSync("public/ai/" + manifest.asset));
const T = new Float64Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
let ref: PolicyPmfBank;
beforeAll(() => { ref = new PolicyPmfBank("DP Expert", (m, u) => T[m * 64 + u]).build(3); }, 60_000);
const small = (f: (k: number) => void) => { for (let m = 0; m < 4096; m++) if (popcount(m) <= 3) for (let u = 0; u < 64; u++) f(m * 64 + u); };

describe("v6 integration helpers", () => {
  it("WASM-built bank (wrapped by bankFromWasm) is bit-identical to the TS bank", async () => {
    const wasm = readFileSync("training/v6-wasm/pmf.wasm");
    const bank = bankFromWasm(await buildBankWasm(wasm, T));
    let n = 0;
    small((k) => { const a = bank.pmf[k]!, b = ref.pmf[k]!; expect(a.length).toBe(b.length); for (let g = 0; g < a.length; g++) expect(a[g]).toBe(b[g]); n++; });
    expect(n).toBeGreaterThan(10000);
    expect(bank.mean[4095 * 64]).toBeCloseTo(191.760879752165, 9);
  }, 120_000);
  it("Float32 and INT16 codecs round-trip within the validated error", () => {
    for (const [kind, tol] of [["f32", 1e-7], ["int16", 2e-5]] as const) {
      const dec = decodeBank(encodeBank(ref, kind));
      let maxErr = 0;
      small((k) => { const a = dec.pmf[k]!, b = ref.pmf[k]!; expect(a.length).toBe(b.length); for (let g = 0; g < a.length; g++) maxErr = Math.max(maxErr, Math.abs(a[g] - b[g])); });
      expect(maxErr).toBeLessThan(tol);
    }
  });
});

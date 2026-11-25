// Reference codecs for shipping the DP Expert PMF bank (v6 execution study §7.3).
// Validated on real decisions: Float32 = 0 material disagreements; INT16 per-state scaling =
// max decision loss 5.9e-7 (quant-study). Format (little endian, browser-friendly):
//   [u32 magic "YPB1"][u32 kind 1=f32 2=int16][u32 states][u32 floats]
//   [i32 key, i32 len] * states                 (canonical keys only, ascending)
//   kind 2 only: [f32 scale] * states           (per-state max probability)
//   payload: f32 * floats  |  u16 * floats      (value = q / 65535 * scale)
// Decoding returns a PolicyPmfBank-shaped object (pmf views + aliases + mean).
import { canonicalUpper } from "../research-v5/kernel";
import { PolicyPmfBank } from "../research-v5/policy-pmf";

const MAGIC = 0x31425059; // "YPB1"
export type BankEncoding = "f32" | "int16";

export function encodeBank(bank: PolicyPmfBank, kind: BankEncoding): ArrayBuffer {
  const keys: number[] = [];
  let floats = 0;
  for (let m = 0; m < 4096; m++) for (let u = 0; u < 64; u++) if (canonicalUpper(m, u) === u && bank.pmf[m * 64 + u]) { keys.push(m * 64 + u); floats += bank.pmf[m * 64 + u]!.length; }
  const head = 16 + keys.length * 8, scales = kind === "int16" ? keys.length * 4 : 0;
  const payloadOff = head + scales, width = kind === "f32" ? 4 : 2;
  const buf = new ArrayBuffer(payloadOff + floats * width + 4);
  const dv = new DataView(buf);
  dv.setUint32(0, MAGIC, true); dv.setUint32(4, kind === "f32" ? 1 : 2, true); dv.setUint32(8, keys.length, true); dv.setUint32(12, floats, true);
  let o = 0;
  keys.forEach((k, i) => {
    const p = bank.pmf[k]!;
    dv.setInt32(16 + i * 8, k, true); dv.setInt32(20 + i * 8, p.length, true);
    if (kind === "f32") for (let g = 0; g < p.length; g++) dv.setFloat32(payloadOff + (o + g) * 4, p[g], true);
    else {
      let mx = 0; for (let g = 0; g < p.length; g++) mx = Math.max(mx, p[g]);
      const sc = Math.fround(mx);
      dv.setFloat32(head + i * 4, sc, true);
      for (let g = 0; g < p.length; g++) dv.setUint16(payloadOff + (o + g) * 2, Math.round((p[g] / sc) * 65535), true);
    }
    o += p.length;
  });
  return buf;
}

export function decodeBank(buf: ArrayBuffer, name = "DP Expert (decoded)"): PolicyPmfBank {
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== MAGIC) throw Error("not a YPB1 bank");
  const kind = dv.getUint32(4, true), states = dv.getUint32(8, true), floats = dv.getUint32(12, true);
  const head = 16 + states * 8, payloadOff = head + (kind === 2 ? states * 4 : 0);
  // decode into one Float32Array (f32: copy-free when aligned; int16: dequantised once)
  const out = kind === 1 && payloadOff % 4 === 0 ? new Float32Array(buf, payloadOff, floats) : new Float32Array(floats);
  const bank = new PolicyPmfBank(name, () => NaN);
  let o = 0;
  for (let i = 0; i < states; i++) {
    const k = dv.getInt32(16 + i * 8, true), len = dv.getInt32(20 + i * 8, true);
    if (kind === 2) { const sc = dv.getFloat32(head + i * 4, true); for (let g = 0; g < len; g++) out[o + g] = (dv.getUint16(payloadOff + (o + g) * 2, true) / 65535) * sc; }
    else if (out.buffer !== buf) for (let g = 0; g < len; g++) out[o + g] = dv.getFloat32(payloadOff + (o + g) * 4, true);
    const view = out.subarray(o, o + len) as unknown as Float64Array;
    bank.pmf[k] = view;
    let mu = 0; for (let g = 0; g < len; g++) mu += g * view[g];
    bank.mean[k] = mu;
    o += len;
  }
  for (let m = 0; m < 4096; m++) for (let u = 0; u < 64; u++) { const cu = canonicalUpper(m, u); if (cu !== u && bank.pmf[m * 64 + cu]) { bank.pmf[m * 64 + u] = bank.pmf[m * 64 + cu]; bank.mean[m * 64 + u] = bank.mean[m * 64 + cu]; } }
  return bank;
}

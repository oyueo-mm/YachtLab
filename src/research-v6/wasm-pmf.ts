// Host-side driver of training/v6-wasm/pmf_wasm.c (freestanding wasm32, no imports).
// Works in Node and in a browser Web Worker: pass the wasm bytes and the DP table.
// The kernel tables come from src/research-v5/kernel.ts so that tie order matches the TS bank.
import { POINTS, PROB, CHILD, HOLD_START, HOLD_LIST } from "../research-v5/kernel";

export const KERNEL_ARRAYS = { POINTS, PROB, CHILD, HOLD_START, HOLD_LIST };
export const BANK_FLOATS = 37_256_480; // canonical floats of the DP Expert bank (v5 §2.1)

export type WasmBank = { data: Float64Array | Float32Array; index: Int32Array; floats: number; buildMs: number; memoryBytes: number };

export async function buildBankWasm(wasm: BufferSource, T: Float64Array, opts: { f32?: boolean; kernel?: typeof KERNEL_ARRAYS } = {}): Promise<WasmBank> {
  const k = opts.kernel ?? KERNEL_ARRAYS;
  const { instance } = await WebAssembly.instantiate(wasm, {});
  const ex = instance.exports as unknown as { memory: WebAssembly.Memory; alloc(n: number): number; build(...a: number[]): bigint };
  const put = <A extends Float64Array | Int16Array | Int32Array>(src: A): number => {
    const p = ex.alloc(src.byteLength);
    if (!p) throw Error("wasm out of memory");
    new Uint8Array(ex.memory.buffer, p, src.byteLength).set(new Uint8Array(src.buffer, src.byteOffset, src.byteLength));
    return p;
  };
  const pT = put(T), pPts = put(k.POINTS), pProb = put(k.PROB), pChild = put(k.CHILD), pHs = put(k.HOLD_START), pHl = put(k.HOLD_LIST);
  const width = opts.f32 ? 4 : 8, cap = BANK_FLOATS + 1024;
  const pData = ex.alloc(cap * width), pIdx = ex.alloc(4096 * 64 * 2 * 4);
  if (!pData || !pIdx) throw Error("wasm out of memory for the bank");
  const t0 = performance.now();
  const floats = Number(ex.build(pT, pPts, pProb, pChild, pHs, pHl, pData, cap, pIdx, opts.f32 ? 1 : 0));
  const buildMs = performance.now() - t0;
  if (floats < 0) throw Error("bank capacity too small");
  const buf = ex.memory.buffer;
  return { data: opts.f32 ? new Float32Array(buf, pData, floats) : new Float64Array(buf, pData, floats), index: new Int32Array(buf, pIdx, 4096 * 64 * 2), floats, buildMs, memoryBytes: buf.byteLength };
}

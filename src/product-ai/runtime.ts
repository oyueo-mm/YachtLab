import { productV5 } from "./models";
import { loadDP, dpFutureValue, requireDPTable } from "../dp";
import { bankFromWasm, buildBankWasm } from "../research-v6/wasm-pmf";
import { readBank, writeBank } from "./opfs-bank";
import { type V5Config } from "../research-v5/apex";
import manifest from "../dp-manifest.json";
import wasmUrl from "../../training/v6-wasm/pmf.wasm?url";

export type InitPhase = "cache" | "build";
export type Runtime = {
  config: V5Config;
  diagnostics: { source: "opfs" | "wasm"; initMs: number; bankBytes: number };
};
let initialization: Promise<Runtime> | undefined;

export function initialize(report: (phase: InitPhase) => void) {
  if (initialization) return initialization;
  initialization = (async (): Promise<Runtime> => {
    const start = performance.now();
    await loadDP();
    const asset = wasmUrl.split("/").at(-1)!.replace(/[^a-z0-9.-]/gi, "_");
    const key = `${productV5.version}-${manifest.sha256}-${asset}.f32`;
    report("cache");
    const cached = await readBank(key);
    if (cached) {
      try {
        return {
          config: { bank: bankFromWasm(cached), dpValue: dpFutureValue, endgame: "none" },
          diagnostics: { source: "opfs", initMs: performance.now() - start, bankBytes: cached.memoryBytes },
        };
      } catch { /* Rebuild an invalid index. */ }
    }
    report("build");
    const response = await fetch(wasmUrl);
    if (!response.ok) throw Error("AI 모델 파일을 불러올 수 없어요.");
    const bytes = await response.arrayBuffer();
    const bank = await buildBankWasm(bytes, requireDPTable(), { f32: true });
    const config = { bank: bankFromWasm(bank), dpValue: dpFutureValue, endgame: "none" as const };
    void writeBank(key, bank);
    return { config, diagnostics: { source: "wasm", initMs: performance.now() - start, bankBytes: bank.memoryBytes } };
  })().catch((error) => { initialization = undefined; throw error; });
  return initialization;
}

// v7.2 product-track candidate (research module; NOT wired into src/ai.ts or src/product-ai/).
// One function for Codex: the same single DP Expert PMF bank that the v5-R browser trial already builds
// (Float32 WASM bank, ~146 MiB WASM memory) drives the I2RO1 estimator. No extra memory, more CPU.
//
//   import { productV7Decision, PRODUCT_V7 } from "src/research-v7/product";
//   const d = productV7Decision(view, runtime.config);   // runtime.config: V5Config { bank, dpValue, endgame: "none" }
//
// Fairness boundary: pass a public view (seed 0, rng [0,0]) exactly as the v5-R worker does.
import type { Game } from "../engine";
import type { V5Config, V5Decision } from "../research-v5/apex";
import { winDPv7Decision, type V7Config } from "./apex7";
import type { V7Kind } from "./interactive";

export const PRODUCT_V7 = { id: "v7-I2RO1", version: "v7.2-research-2026-11-25", kind: "I2RO1" as V7Kind, banks: 1 } as const;

const cfgCache = new WeakMap<object, V7Config>();
/** I2RO1 decision with the single bank of a v5-R config. `kind` override is for research (e.g. "I2R1"). */
export function productV7Decision(state: Game, base: V5Config, kind: V7Kind = PRODUCT_V7.kind): V5Decision {
  let cfg = cfgCache.get(base.bank);
  if (!cfg || cfg.kind !== kind) { cfg = { ...base, endgame: "none", v7: { banks: [base.bank], dp: base.bank }, kind }; cfgCache.set(base.bank, cfg); }
  return winDPv7Decision(state, cfg);
}

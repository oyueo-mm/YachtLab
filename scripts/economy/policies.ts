/**
 * Skill-tier proxy policies for the economy study (research only; not registered as game AIs).
 * A tier is DP Expert's action values passed through a softmax with temperature `tau`
 * (tau = 0 → exact DP Expert). Decisions only read the public game state (dice, cards, rolls):
 * the policy never reads the engine RNG/seed. Its own sampling uses a separate RNG.
 */
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { categories, type Game } from "../../src/engine";
import { dpActionValues, setDPTable } from "../../src/dp";

let loaded = false;
export function loadDPTable() {
  if (loaded) return;
  const manifest = JSON.parse(readFileSync("src/dp-manifest.json", "utf8"));
  const data = gunzipSync(readFileSync(`public/ai/${manifest.asset}`));
  setDPTable(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
  loaded = true;
}

export type Tier = { id: string; label: string; tau: number };
export type PolicyAction = { kind: "score"; category: (typeof categories)[number] } | { kind: "hold"; ids: number[] };

/** xorshift32 policy RNG (separate from the game RNG). */
export function policyRng(seed: number) {
  let s = seed >>> 0 || 0x9e3779b9;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

export function softDPAction(state: Game, tau: number, rand: () => number): PolicyAction {
  const q = dpActionValues(state);
  let best = -1;
  for (let i = 0; i < q.length; i++) if (Number.isFinite(q[i]) && (best < 0 || q[i] > q[best])) best = i;
  let pick = best;
  if (tau > 0) {
    let z = 0;
    const w = q.map((v) => (Number.isFinite(v) ? Math.exp((v - q[best]) / tau) : 0));
    for (const x of w) z += x;
    let r = rand() * z;
    for (let i = 0; i < w.length; i++) {
      r -= w[i];
      if (w[i] > 0 && r <= 0) { pick = i; break; }
    }
  }
  if (pick >= 32) return { kind: "score", category: categories[pick - 32] };
  return { kind: "hold", ids: [0, 1, 2, 3, 4].filter((id) => pick & (1 << id)) };
}

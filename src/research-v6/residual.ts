// v6-C residual value model: exact interactive value - v6-P policy-set value, for positions
// where the opponent moves next and both players have <= 4 categories left. Linear (ridge)
// on hand-made features; weights fitted by scripts/research-v6/residual-fit6.ts (game split).
import { upperHeadroom } from "../research-v5/kernel";
export const RESIDUAL_MAX_K = 4;
export function residualFeatures(kMe: number, Mme: number, uMe: number, Tme: number, kOpp: number, Mopp: number, uOpp: number, Topp: number, v: number): number[] {
  const f = [1, (Tme - Topp) / 100, v, v * v, v * (1 - v)];
  for (let k = 0; k <= 4; k++) f.push(kMe === k ? 1 : 0, kMe === k ? v * (1 - v) : 0);
  for (let k = 1; k <= 4; k++) f.push(kOpp === k ? 1 : 0, kOpp === k ? v * (1 - v) : 0);
  for (let c = 0; c < 12; c++) f.push((Mme >> c) & 1, (Mopp >> c) & 1);
  const pend = (M: number, u: number) => ((M & 63) && u < 63 && u + upperHeadroom(M) >= 63 ? 1 : 0);
  f.push(pend(Mme, uMe), pend(Mopp, uOpp), pend(Mme, uMe) * (63 - uMe) / 63, pend(Mopp, uOpp) * (63 - uOpp) / 63);
  return f;
}
export const predictResidual = (w: number[], f: number[]) => { let s = 0; for (let i = 0; i < f.length; i++) s += w[i] * f[i]; return s; };

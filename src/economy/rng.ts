/** Deterministic RNG + samplers for the economy simulator (mulberry32). Never uses Math.random. */
export type Rng = () => number;
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Stable 32-bit hash for deriving sub-seeds from strings + numbers. */
export function hashSeed(...parts: (string | number)[]): number {
  let h = 2166136261;
  for (const p of parts) for (const ch of String(p) + "|") { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
export function normal(r: Rng): number {
  let u = 0, v = 0;
  while (u === 0) u = r();
  while (v === 0) v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
export function poisson(r: Rng, mean: number): number {
  if (mean <= 0) return 0;
  if (mean > 40) return Math.max(0, Math.round(mean + Math.sqrt(mean) * normal(r)));
  const L = Math.exp(-mean);
  let k = 0, p = 1;
  do { k++; p *= r(); } while (p > L);
  return k - 1;
}
export function binomial(r: Rng, n: number, p: number): number {
  if (n <= 0 || p <= 0) return 0;
  if (p >= 1) return n;
  if (n * p < 10 && n > 60) return Math.min(n, poisson(r, n * p));
  if (n > 60) return Math.min(n, Math.max(0, Math.round(n * p + Math.sqrt(n * p * (1 - p)) * normal(r))));
  let k = 0;
  for (let i = 0; i < n; i++) if (r() < p) k++;
  return k;
}
/** Gamma(shape, 1) — Marsaglia & Tsang. */
export function gamma(r: Rng, shape: number): number {
  if (shape < 1) return gamma(r, shape + 1) * r() ** (1 / shape);
  const d = shape - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number, v: number;
    do { x = normal(r); v = 1 + c * x; } while (v <= 0);
    v = v * v * v;
    const u = r();
    if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}
/** Negative binomial with given mean and shape k (variance = mean + mean²/k). */
export function negBinomial(r: Rng, mean: number, k: number): number {
  if (mean <= 0) return 0;
  return poisson(r, gamma(r, k) * (mean / k));
}
export function pickWeighted<T extends string>(r: Rng, weights: Partial<Record<T, number>>): T {
  const entries = Object.entries(weights) as [T, number][];
  const z = entries.reduce((a, [, w]) => a + w, 0);
  let x = r() * z;
  for (const [k, w] of entries) { x -= w; if (x <= 0) return k; }
  return entries[entries.length - 1][0];
}
export function quantile(sorted: ArrayLike<number>, q: number): number {
  if (!sorted.length) return NaN;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1) + 0.5)));
  return sorted[i];
}
export function summary(values: number[]) {
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  const mean = n ? s.reduce((a, b) => a + b, 0) / n : NaN;
  return { n, mean, p10: quantile(s, 0.1), p25: quantile(s, 0.25), median: quantile(s, 0.5), p75: quantile(s, 0.75), p90: quantile(s, 0.9), p99: quantile(s, 0.99), min: s[0] ?? NaN, max: s[n - 1] ?? NaN };
}
export type Summary = ReturnType<typeof summary>;
/** Gini coefficient of non-negative values. */
export function gini(values: number[]): number {
  const s = values.map((v) => Math.max(0, v)).sort((a, b) => a - b);
  const n = s.length, total = s.reduce((a, b) => a + b, 0);
  if (!n || total === 0) return 0;
  let cum = 0;
  for (let i = 0; i < n; i++) cum += (i + 1) * s[i];
  return (2 * cum) / (n * total) - (n + 1) / n;
}

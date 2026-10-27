// Bijective 32-bit finalizer spreads fixed counters across the LCG seed space.
// Adjacent raw LCG seeds have correlated first rolls; avoid that sample design.
export function evaluationSeed(index) {
  let x = (200000 + index) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
}

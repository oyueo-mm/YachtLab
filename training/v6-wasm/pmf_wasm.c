// YachtLab v6: freestanding WebAssembly builder of the exact DP Expert policy-PMF bank.
// No libc, no imports: runs unchanged in Node and in a browser Web Worker.
// The dice kernel (points, probabilities, chance tree, hold lists in kernel order)
// is passed in from JS (src/research-v5/kernel.ts), so tie-breaking and the order of
// floating-point operations mirror src/research-v5/policy-pmf.ts PolicyPmfBank.build
// -> the Float64 output is expected to be bit-identical (checked by the bench script).
// Build: clang --target=wasm32 -O3 -mbulk-memory [-msimd128] -nostdlib -Wl,--no-entry -o pmf.wasm pmf_wasm.c
#define FULL 252
#define OFFSET 210
#define PARTIAL 462
typedef unsigned long size_t;
extern unsigned char __heap_base;
static size_t heap_top = 0;
__attribute__((export_name("alloc"))) void* alloc(int bytes) {
  if (!heap_top) heap_top = (size_t)&__heap_base;
  size_t p = (heap_top + 15) & ~(size_t)15, end = p + (size_t)bytes;
  size_t have = __builtin_wasm_memory_size(0) * 65536;
  if (end > have && __builtin_wasm_memory_grow(0, (end - have + 65535) / 65536) == (size_t)-1) return 0;
  heap_top = end;
  return (void*)p;
}
static int popcount(int m) { int n = 0; for (; m; m &= m - 1) n++; return n; }
static int headroom(int mask) { int s = 0; for (int c = 0; c < 6; c++) if (mask & (1 << c)) s += 5 * (c + 1); return s; }
static int canon(int mask, int u) { int um = u < 63 ? u : 63; if (!(mask & 63)) return 0; if (um >= 63) return 63; if (um + headroom(mask) < 63) return 0; return um; }
static int nextUpper(int c, int p, int u) { if (c >= 6) return u; int v = u + p; return v < 63 ? v : 63; }

static double stopVal[FULL], v1[FULL], v2[FULL], massA[FULL], e[PARTIAL], part[PARTIAL], out[12 * 64], cont[12 * 64];
static short stopCat[FULL], act1[FULL], act2[FULL];

static const short *POINTS, *CHILD, *HOLD_LIST; static const double* PROB; static const int* HOLD_START;
static void chance(const double* full) {
  for (int d = 0; d < FULL; d++) e[OFFSET + d] = full[d];
  for (int h = OFFSET - 1; h >= 0; h--) { const short* b = CHILD + h * 6; e[h] = (e[b[0]] + e[b[1]] + e[b[2]] + e[b[3]] + e[b[4]] + e[b[5]]) / 6; }
}
static void backup(const double* prev, double* dst, short* act) {
  chance(prev);
  for (int d = 0; d < FULL; d++) {
    double best = stopVal[d]; int a = -1;
    for (int i = HOLD_START[d], end = HOLD_START[d + 1] - 1; i < end; i++) { int h = HOLD_LIST[i]; if (e[h] > best) { best = e[h]; a = h; } }
    dst[d] = best; act[d] = (short)a;
  }
}

/**
 * T: DP Expert table (4096*64 Float64). Output: data (Float64 or Float32 when f32 != 0),
 * index[key*2] = offset, index[key*2+1] = length for canonical keys (others untouched).
 * Returns the number of stored floats, or -1 if `cap` is too small.
 */
__attribute__((export_name("build")))
long long build(const double* T, const short* points, const double* prob, const short* child, const int* holdStart, const short* holdList,
                void* data, int cap, int* index, int f32) {
  POINTS = points; PROB = prob; CHILD = child; HOLD_START = holdStart; HOLD_LIST = holdList;
  double* D = (double*)data; float* F = (float*)data;
  int used = 0;
  for (int pc = 0; pc <= 12; pc++) for (int mask = 0; mask < 4096; mask++) {
    if (popcount(mask) != pc) continue;
    for (int u = 0; u <= 63; u++) {
      if (canon(mask, u) != u) continue;
      int key = mask * 64 + u;
      if (!mask) { if (used + 1 > cap) return -1; if (f32) F[used] = 1; else D[used] = 1; index[key * 2] = used; index[key * 2 + 1] = 1; used++; continue; }
      for (int c = 0; c < 12; c++) {
        if (!(mask & (1 << c))) continue;
        int next = mask ^ (1 << c);
        for (int p = 0; p <= 50; p++) cont[c * 64 + p] = __builtin_nan("");
        for (int d = 0; d < FULL; d++) { int p = POINTS[d * 12 + c]; if (cont[c * 64 + p] != cont[c * 64 + p]) cont[c * 64 + p] = T[next * 64 + canon(next, nextUpper(c, p, u))]; }
      }
      for (int d = 0; d < FULL; d++) {
        double best = -__builtin_inf(); int bc = -1;
        for (int c = 0; c < 12; c++) {
          if (!(mask & (1 << c))) continue;
          int p = POINTS[d * 12 + c];
          double v = (double)(p + (c < 6 && u < 63 && u + p >= 63 ? 35 : 0)) + cont[c * 64 + p];
          if (v > best) { best = v; bc = c; }
        }
        stopVal[d] = best; stopCat[d] = (short)bc;
      }
      backup(stopVal, v1, act1);
      backup(v1, v2, act2);
      for (int k = 0; k < 12 * 64; k++) out[k] = 0;
      for (int d = 0; d < FULL; d++) massA[d] = PROB[d];
      for (int pass = 0; pass < 2; pass++) {
        const short* act = pass == 0 ? act2 : act1;
        for (int h = 0; h < PARTIAL; h++) part[h] = 0;
        for (int d = 0; d < FULL; d++) {
          double m = massA[d]; if (m == 0) continue;
          int a = act[d];
          if (a < 0) { int c = stopCat[d]; out[c * 64 + POINTS[d * 12 + c]] += m; continue; }
          part[a] += m;
        }
        for (int h = 0; h < OFFSET; h++) {
          double m = part[h]; if (m == 0) continue;
          double q = m / 6; const short* b = CHILD + h * 6;
          part[b[0]] += q; part[b[1]] += q; part[b[2]] += q; part[b[3]] += q; part[b[4]] += q; part[b[5]] += q;
        }
        for (int d = 0; d < FULL; d++) massA[d] = part[OFFSET + d];
      }
      for (int d = 0; d < FULL; d++) { double m = massA[d]; if (m == 0) continue; int c = stopCat[d]; out[c * 64 + POINTS[d * 12 + c]] += m; }
      int len = 1;
      for (int k = 0; k < 12 * 64; k++) if (out[k] > 0) {
        int c = k >> 6, raw = k & 63, next = mask ^ (1 << c), ck = next * 64 + canon(next, nextUpper(c, raw, u));
        int shift = raw + (c < 6 && u < 63 && u + raw >= 63 ? 35 : 0);
        if (shift + index[ck * 2 + 1] > len) len = shift + index[ck * 2 + 1];
      }
      if (used + len > cap) return -1;
      if (f32) { for (int g = 0; g < len; g++) F[used + g] = 0; } else { for (int g = 0; g < len; g++) D[used + g] = 0; }
      // accumulate in double precision even for Float32 storage
      static double acc[512];
      for (int g = 0; g < len; g++) acc[g] = 0;
      for (int k = 0; k < 12 * 64; k++) if (out[k] > 0) {
        int c = k >> 6, raw = k & 63, next = mask ^ (1 << c), ck = next * 64 + canon(next, nextUpper(c, raw, u));
        int shift = raw + (c < 6 && u < 63 && u + raw >= 63 ? 35 : 0), off = index[ck * 2], cl = index[ck * 2 + 1];
        double p = out[k];
        if (f32) for (int g = 0; g < cl; g++) acc[shift + g] += p * (double)F[off + g];
        else for (int g = 0; g < cl; g++) acc[shift + g] += p * D[off + g];
      }
      if (f32) for (int g = 0; g < len; g++) F[used + g] = (float)acc[g]; else for (int g = 0; g < len; g++) D[used + g] = acc[g];
      index[key * 2] = used; index[key * 2 + 1] = len; used += len;
    }
  }
  return used;
}

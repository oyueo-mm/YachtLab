// Independent native re-implementation of the v5 exact DP Expert policy-PMF bank.
// Does NOT read dp-kernel.json: multisets, scoring and the chance tree are
// re-derived here, so agreement with the TypeScript bank is a cross-check.
// Input : raw little-endian Float64 DP table (4096*64), output: same binary bank
//         format as scripts/research-v5/bank-io.ts (yachtlab-policy-pmf-1).
// Build : g++ -O3 -march=native -std=c++17 pmf_bank.cpp -o pmf_bank
#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <map>
#include <string>
#include <vector>
using namespace std;
using Counts = array<int, 7>; // counts[1..6]

static vector<Counts> partial;       // all multisets of size 0..5
static map<Counts, int> pindex;
static vector<int> fullIds;          // partial indices of size-5 multisets
static vector<int> fullOf;           // partial index -> full id or -1
static vector<array<int, 6>> child;  // partial (<5) -> partial with one more die of face f
static vector<vector<int>> holdsOf;  // full id -> partial holds (excluding the full hold)
static vector<double> prob;          // full id -> probability
static vector<array<int, 12>> pts;   // full id -> category points

static int scoreOf(const Counts& c, int cat) {
  int sum = 0, mx = 0; bool three = false, two = false;
  for (int f = 1; f <= 6; f++) { sum += f * c[f]; mx = max(mx, c[f]); if (c[f] == 3) three = true; if (c[f] == 2) two = true; }
  if (cat < 6) return c[cat + 1] * (cat + 1);
  auto has = [&](int a, int b) { for (int f = a; f <= b; f++) if (!c[f]) return false; return true; };
  switch (cat) {
    case 6: return sum;
    case 7: return mx >= 4 ? sum : 0;
    case 8: return three && two ? sum : 0;
    case 9: return (has(1, 4) || has(2, 5) || has(3, 6)) ? 15 : 0;
    case 10: return (has(1, 5) || has(2, 6)) ? 30 : 0;
    case 11: return mx == 5 ? 50 : 0;
  }
  return 0;
}
static void enumerate(Counts c, int face, int left) {
  if (face == 7) { pindex[c] = (int)partial.size(); partial.push_back(c); return; }
  for (int k = 0; k <= left; k++) { c[face] = k; enumerate(c, face + 1, left - k); }
}
static void buildKernel() {
  Counts z{}; enumerate(z, 1, 5);
  // order partial by size so that children have larger indices
  vector<pair<int, Counts>> tmp;
  for (auto& c : partial) { int s = 0; for (int f = 1; f <= 6; f++) s += c[f]; tmp.push_back({s, c}); }
  sort(tmp.begin(), tmp.end(), [](auto& a, auto& b) { return a.first < b.first || (a.first == b.first && a.second < b.second); });
  partial.clear(); pindex.clear();
  for (auto& t : tmp) { pindex[t.second] = (int)partial.size(); partial.push_back(t.second); }
  int n = partial.size(); child.assign(n, {}); fullOf.assign(n, -1);
  double fact[6] = {1, 1, 2, 6, 24, 120};
  for (int i = 0; i < n; i++) {
    int s = 0; for (int f = 1; f <= 6; f++) s += partial[i][f];
    if (s < 5) for (int f = 1; f <= 6; f++) { Counts c = partial[i]; c[f]++; child[i][f - 1] = pindex[c]; }
    else {
      fullOf[i] = (int)fullIds.size(); fullIds.push_back(i);
      double p = 120; for (int f = 1; f <= 6; f++) p /= fact[partial[i][f]];
      prob.push_back(p / 7776.0);
      array<int, 12> a{}; for (int c = 0; c < 12; c++) a[c] = scoreOf(partial[i], c);
      pts.push_back(a);
    }
  }
  holdsOf.assign(fullIds.size(), {});
  for (size_t d = 0; d < fullIds.size(); d++) {
    const Counts& full = partial[fullIds[d]];
    for (int i = 0; i < n; i++) {
      bool sub = true; int s = 0;
      for (int f = 1; f <= 6; f++) { if (partial[i][f] > full[f]) sub = false; s += partial[i][f]; }
      if (sub && s < 5) holdsOf[d].push_back(i);
    }
  }
}
static int headroom(int mask) { int s = 0; for (int c = 0; c < 6; c++) if (mask >> c & 1) s += 5 * (c + 1); return s; }
static int canon(int mask, int u) { u = min(63, u); if (!(mask & 63)) return 0; if (u >= 63) return 63; if (u + headroom(mask) < 63) return 0; return u; }

int main(int argc, char** argv) {
  if (argc < 3) { fprintf(stderr, "usage: pmf_bank dp_table.f64 out.f64bank\n"); return 2; }
  vector<double> T(4096 * 64);
  FILE* f = fopen(argv[1], "rb"); if (!f || fread(T.data(), 8, T.size(), f) != T.size()) { fprintf(stderr, "bad table\n"); return 1; } fclose(f);
  auto t0 = chrono::steady_clock::now();
  buildKernel();
  const int NF = fullIds.size(), NP = partial.size();
  vector<vector<double>> pmf(4096 * 64);
  vector<double> stopV(NF), v1(NF), e(NP), mass(NF), part(NP), out(12 * 64), cont(12 * 64);
  vector<int> stopC(NF), act1(NF), act2(NF);
  vector<int> masks(4096); for (int m = 0; m < 4096; m++) masks[m] = m;
  sort(masks.begin(), masks.end(), [](int a, int b) { int pa = __builtin_popcount(a), pb = __builtin_popcount(b); return pa < pb || (pa == pb && a < b); });
  auto chance = [&](const vector<double>& full) { for (int i = NP - 1; i >= 0; i--) { if (fullOf[i] >= 0) e[i] = full[fullOf[i]]; else { double s = 0; for (int k = 0; k < 6; k++) s += e[child[i][k]]; e[i] = s / 6; } } };
  long long floats = 0; int canonical = 0; double maxMass = 0, maxMean = 0;
  for (int mask : masks) for (int u = 0; u < 64; u++) {
    if (canon(mask, u) != u) continue;
    int key = mask * 64 + u; canonical++;
    if (!mask) { pmf[key] = {1.0}; floats++; continue; }
    for (int c = 0; c < 12; c++) if (mask >> c & 1) for (int p = 0; p <= 50; p++) { int nu = c < 6 ? min(63, u + p) : u; int nm = mask ^ (1 << c); cont[c * 64 + p] = T[nm * 64 + canon(nm, nu)]; }
    for (int d = 0; d < NF; d++) {
      double best = -1e300; int bc = -1;
      for (int c = 0; c < 12; c++) if (mask >> c & 1) { int p = pts[d][c]; double g = p + ((c < 6 && u < 63 && u + p >= 63) ? 35 : 0); double v = g + cont[c * 64 + p]; if (v > best) { best = v; bc = c; } }
      stopV[d] = best; stopC[d] = bc;
    }
    auto backup = [&](const vector<double>& prev, vector<double>& dst, vector<int>& act) {
      chance(prev);
      for (int d = 0; d < NF; d++) { double best = stopV[d]; int a = -1; for (int h : holdsOf[d]) if (e[h] > best) { best = e[h]; a = h; } dst[d] = best; act[d] = a; }
    };
    vector<double> v2(NF);
    backup(stopV, v1, act1); backup(v1, v2, act2);
    fill(out.begin(), out.end(), 0.0);
    for (int d = 0; d < NF; d++) mass[d] = prob[d];
    for (vector<int>* act : {&act2, &act1}) {
      fill(part.begin(), part.end(), 0.0);
      for (int d = 0; d < NF; d++) { double m = mass[d]; if (!m) continue; int a = (*act)[d]; if (a < 0) { int c = stopC[d]; out[c * 64 + pts[d][c]] += m; } else part[a] += m; }
      for (int i = 0; i < NP; i++) { if (fullOf[i] >= 0 || !part[i]) continue; double q = part[i] / 6; for (int k = 0; k < 6; k++) part[child[i][k]] += q; }
      for (int d = 0; d < NF; d++) mass[d] = part[fullIds[d]];
    }
    for (int d = 0; d < NF; d++) if (mass[d]) { int c = stopC[d]; out[c * 64 + pts[d][c]] += mass[d]; }
    size_t len = 1;
    for (int k = 0; k < 12 * 64; k++) if (out[k] > 0) { int c = k >> 6, p = k & 63; int nm = mask ^ (1 << c); int g = p + ((c < 6 && u < 63 && u + p >= 63) ? 35 : 0); len = max(len, g + pmf[nm * 64 + canon(nm, c < 6 ? min(63, u + p) : u)].size()); }
    vector<double> r(len, 0.0);
    for (int k = 0; k < 12 * 64; k++) if (out[k] > 0) {
      int c = k >> 6, p = k & 63; int nm = mask ^ (1 << c); int g = p + ((c < 6 && u < 63 && u + p >= 63) ? 35 : 0);
      const vector<double>& ch = pmf[nm * 64 + canon(nm, c < 6 ? min(63, u + p) : u)];
      for (size_t i = 0; i < ch.size(); i++) r[g + i] += out[k] * ch[i];
    }
    double s = 0, mu = 0; for (size_t i = 0; i < len; i++) { s += r[i]; mu += i * r[i]; }
    maxMass = max(maxMass, fabs(s - 1)); maxMean = max(maxMean, fabs(mu - T[key]));
    floats += len; pmf[key] = move(r);
  }
  double secs = chrono::duration<double>(chrono::steady_clock::now() - t0).count();
  FILE* o = fopen(argv[2], "wb");
  string header = "{\"format\":\"yachtlab-policy-pmf-1\",\"name\":\"DP Expert (native)\",\"states\":" + to_string(canonical) + ",\"floats\":" + to_string(floats) + "}\n";
  fwrite(header.data(), 1, header.size(), o);
  for (int mask = 0; mask < 4096; mask++) for (int u = 0; u < 64; u++) if (canon(mask, u) == u) { int k = mask * 64 + u; int len = pmf[k].size(); fwrite(&k, 4, 1, o); fwrite(&len, 4, 1, o); }
  for (int mask = 0; mask < 4096; mask++) for (int u = 0; u < 64; u++) if (canon(mask, u) == u) fwrite(pmf[mask * 64 + u].data(), 8, pmf[mask * 64 + u].size(), o);
  fclose(o);
  printf("{\"canonicalStates\":%d,\"floats\":%lld,\"seconds\":%.3f,\"maxMassError\":%.3e,\"maxMeanError\":%.3e,\"initialMean\":%.15f}\n", canonical, floats, secs, maxMass, maxMean, [&] { double m = 0; auto& p = pmf[4095 * 64]; for (size_t i = 0; i < p.size(); i++) m += i * p[i]; return m; }());
}

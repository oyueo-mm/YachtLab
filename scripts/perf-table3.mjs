#!/usr/bin/env node
/** Markdown table main → A1 → A1.1 from three measure-board-fx-perf.mjs JSON files (A1.1). */
import { readFileSync } from "node:fs";
const [, , mainPath, a1Path, a11Path, title = ""] = process.argv;
const [M, A, B] = [mainPath, a1Path, a11Path].map((p) => JSON.parse(readFileSync(p, "utf8")));
const pct = (r) => (r.n ? Math.round((r.over33 / r.n) * 1000) / 10 : 0);
const cell = (f) => [M, A, B].map((x, i) => (i === 2 ? `**${f(x)}**` : f(x))).join(" → ");
const rows = [`**${title}** (${B.env}; ${B.trials}회 × ${B.rolls}굴림, CPU 감속 ${B.cpu}×). 각 칸: main → A1(08c507b) → **A1.1**`, "",
  "| 장착 | 굴림 평균 ms | p95 | p99 | 33ms 초과 % | 첫 굴림 → 마지막 1/3 평균 | 탭→첫 프레임 p50 | 정지 중 CPU % | 굴림 중 CPU % | 힙(GC 후) MB | 초기 로드 ms | 품질 단계 |",
  "|---|---|---|---|---|---|---|---|---|---|---|---|"];
for (const key of Object.keys(B.combos)) {
  const c = (x) => x.combos[key];
  if (!c(M) || !c(A)) continue;
  const v = (f) => cell((x) => f(c(x)));
  rows.push(`| ${key} | ${v((r) => r.rollFrames.avg)} | ${v((r) => r.rollFrames.p95)} | ${v((r) => r.rollFrames.p99)} | ${v((r) => pct(r.rollFrames))} | ${v((r) => `${r.firstRollFrames.avg}→${r.laterRollFrames.avg}`)} | ${v((r) => r.tapToFirstFrameMs.p50)} | ${v((r) => r.cpuIdlePct)} | ${v((r) => r.cpuRollPct)} | ${v((r) => r.heapMB)} | ${v((r) => r.initMs)} | ${(c(B).fxTier ?? []).join("/") || "0"} |`);
}
console.log(rows.join("\n"));

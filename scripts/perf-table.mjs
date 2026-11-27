#!/usr/bin/env node
/** Markdown before/after table from two measure-board-fx-perf.mjs JSON files. */
import { readFileSync } from "node:fs";
const [, , beforePath, afterPath, title = ""] = process.argv;
const b = JSON.parse(readFileSync(beforePath, "utf8")), a = JSON.parse(readFileSync(afterPath, "utf8"));
const rows = [`**${title}** (${a.env}; ${a.trials}회 × ${a.rolls}굴림, CPU 감속 ${a.cpu}×)`, "", "| 장착 | 굴림 프레임 평균 / p95 / p99 (ms) | 33ms 초과 프레임 | 첫 굴림 → 마지막 1/3 평균 | 정지 중 평균 / CPU | 굴림 중 CPU | 탭→첫 프레임 p50 | 힙(GC 후) / 증가 | 캔버스 |", "|---|---|---|---|---|---|---|---|---|"];
const f = (x) => (x === undefined ? "—" : x);
for (const key of Object.keys(a.combos)) {
  const B = b.combos[key], A = a.combos[key];
  if (!B) continue;
  const pair = (fb, fa) => `${fb} → **${fa}**`;
  rows.push(`| ${key} | ${pair(`${B.rollFrames.avg}/${B.rollFrames.p95}/${B.rollFrames.p99}`, `${A.rollFrames.avg}/${A.rollFrames.p95}/${A.rollFrames.p99}`)} | ${pair(`${B.rollFrames.over33}/${B.rollFrames.n}`, `${A.rollFrames.over33}/${A.rollFrames.n}`)} | ${pair(`${f(B.firstRollFrames.avg)}→${f(B.laterRollFrames.avg)}`, `${f(A.firstRollFrames.avg)}→${f(A.laterRollFrames.avg)}`)} | ${pair(`${B.idleFrames.avg} / ${B.cpuIdlePct}%`, `${A.idleFrames.avg} / ${A.cpuIdlePct}%`)} | ${pair(B.cpuRollPct + "%", A.cpuRollPct + "%")} | ${pair(B.tapToFirstFrameMs.p50, A.tapToFirstFrameMs.p50)} | ${pair(`${B.heapMB}/${B.heapGrowthMB}`, `${A.heapMB}/${A.heapGrowthMB}`)} MB | ${pair(B.canvases, A.canvases)} |`);
}
rows.push("", `초기 화면(내비게이션→게임판) 평균: ${Object.keys(a.combos).map((k) => `${k} ${b.combos[k]?.initMs}→${a.combos[k].initMs} ms`).join(", ")}.`);
console.log(rows.join("\n"));

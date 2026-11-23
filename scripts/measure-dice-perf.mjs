#!/usr/bin/env node
/**
 * 3D dice roll performance probe (emulated phone, headless Chromium).
 *
 *   npm run build && node scripts/measure-dice-perf.mjs [--trials 5] [--cpu 4] [--wait 600] [--out file.json]
 *
 * Each trial is a fresh browser context (cold caches, like opening the site again):
 *   load → AI game setup → "게임 시작" → wait `--wait` ms → roll 1 (first roll of the game)
 *   → roll 2 → roll 3 (same turn) → score → wait for the AI turn → roll 1 of turn 2.
 * Per roll it records tap → first 3D frame, every frame interval from the tap until the dice rest
 * (avg / median / p95 / p99 / worst), main-thread long tasks ≥ 50 ms in that window, physics time,
 * whether pre-computed physics was reused, canvas pixel ratio and animation length.
 * Per trial: time from navigation to the game board, and JS heap after the last roll.
 *
 * This is an EMULATION (software GPU, CDP CPU throttling). It is not a real-device measurement.
 */
import { chromium, devices } from "playwright";
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const arg = (name, fallback) => {
  const i = process.argv.indexOf("--" + name);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const TRIALS = Number(arg("trials", 5));
const CPU = Number(arg("cpu", 4));
const WAIT = Number(arg("wait", 600));
/** Pause between re-rolls of the same turn (a player looking at the dice). 0 = tap as soon as possible. */
const GAP = Number(arg("gap", 700));
const OUT = arg("out", "");
const PORT = Number(arg("port", 4179));
const BASE = `http://127.0.0.1:${PORT}/YachtLab/`;

const server = spawn("npx", ["vite", "preview", "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"], { stdio: "ignore" });
const stop = () => server.kill();
process.on("exit", stop);
for (let i = 0; i < 60; i++) {
  try {
    if ((await fetch(BASE)).ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 250));
}

const PROBE = () => {
  const w = window;
  w.__probe = { frames: [], long: [], taps: [] };
  const loop = (t) => {
    w.__probe.frames.push(t);
    if (w.__probe.frames.length > 20000) w.__probe.frames.splice(0, 10000);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) w.__probe.long.push({ start: e.startTime, dur: e.duration });
    }).observe({ type: "longtask", buffered: true });
  } catch {}
  addEventListener("pointerdown", (e) => {
    if (e.target?.closest?.(".roll-button")) w.__probe.taps.push(performance.now());
  }, true);
};

const q = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0);
const r1 = (x) => Math.round(x * 10) / 10;

async function rollOnce(page, label) {
  const before = await page.evaluate(() => window.__yachtlabDice?.history.length ?? 0);
  const button = page.locator(".page-play .roll-button");
  await button.waitFor({ state: "visible" });
  await page.waitForFunction(() => !document.querySelector(".page-play .roll-button")?.disabled, null, { timeout: 30000 });
  await button.click();
  await page.waitForFunction((n) => (window.__yachtlabDice?.history.length ?? 0) > n, before, { timeout: 30000 });
  await page.waitForTimeout(150);
  return page.evaluate((label) => {
    const p = window.__probe;
    const roll = window.__yachtlabDice.last;
    const tap = p.taps.at(-1);
    const end = roll.endedAt;
    const ts = p.frames.filter((t) => t > tap && t <= end + 0.5);
    const intervals = [];
    let prev = tap;
    for (const t of ts) {
      intervals.push(t - prev);
      prev = t;
    }
    const sorted = [...intervals].sort((a, b) => a - b);
    const long = p.long.filter((l) => l.start + l.dur > tap && l.start < end);
    return {
      label,
      tapToFirstFrame: roll.firstFrameAt ? roll.firstFrameAt - tap : null,
      tapToEffect: roll.effectStartAt ? roll.effectStartAt - tap : null,
      frames: intervals.length,
      avg: intervals.reduce((a, b) => a + b, 0) / Math.max(1, intervals.length),
      median: sorted[Math.floor(sorted.length / 2)] ?? 0,
      p95: sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] : 0,
      p99: sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))] : 0,
      worst: sorted.at(-1) ?? 0,
      longTasks: long.length,
      longTaskMs: long.reduce((a, l) => a + l.dur, 0),
      longAt: long.map((l) => [Math.round(l.start - tap), Math.round(l.dur)]),
      slowFrames: intervals.map((d, i) => [i, Math.round(d)]).filter(([, d]) => d > 34),
      simMs: roll.simMs,
      prepared: roll.prepared,
      pixelRatio: roll.pixelRatio,
      animMs: end - (roll.firstFrameAt ?? tap),
    };
  }, label);
}

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
const results = [];
for (let trial = 0; trial < TRIALS; trial++) {
  const context = await browser.newContext({ ...devices["Pixel 7"], reducedMotion: "no-preference" });
  await context.addInitScript(PROBE);
  if (process.env.PERF_SETTINGS) await context.addInitScript((v) => localStorage.setItem("yachtlab.settings.v1", v), process.env.PERF_SETTINGS);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable");
  if (CPU > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });
  // Start straight from the setup screen with "내가 먼저".
  const navStart = Date.now();
  await page.goto(BASE + "#play-setup");
  await page.getByRole("radiogroup", { name: "선공" }).getByText("내가 먼저", { exact: true }).click();
  await page.getByRole("button", { name: "게임 시작" }).click();
  await page.locator(".page-play .game-board").waitFor();
  const loadMs = Date.now() - navStart;
  await page.waitForTimeout(WAIT);
  const rolls = [];
  rolls.push(await rollOnce(page, "first"));
  await page.waitForTimeout(GAP);
  rolls.push(await rollOnce(page, "second"));
  await page.waitForTimeout(GAP);
  rolls.push(await rollOnce(page, "third"));
  // score via the score sheet, then wait for the AI turn to finish
  await page.getByRole("button", { name: /점수/ }).first().click().catch(() => {});
  const sheet = page.getByRole("dialog", { name: "점수판" });
  if (await sheet.isVisible().catch(() => false)) await sheet.locator(".score-option").first().click();
  await page.waitForFunction(() => {
    const b = document.querySelector(".page-play .roll-button");
    return b && !b.disabled && /주사위 굴리기/.test(b.textContent ?? "");
  }, null, { timeout: 60000 });
  await page.waitForTimeout(WAIT);
  rolls.push(await rollOnce(page, "nextTurn"));
  const metrics = Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
  results.push({ trial, loadMs, heapMB: r1((metrics.JSHeapUsedSize ?? 0) / 1048576), rolls });
  console.log(`trial ${trial}: load ${loadMs} ms, heap ${r1((metrics.JSHeapUsedSize ?? 0) / 1048576)} MB`);
  for (const r of rolls)
    console.log(`  ${r.label.padEnd(8)} tap→effect ${r1(r.tapToEffect)} tap→frame ${r1(r.tapToFirstFrame)} ms  avg ${r1(r.avg)} med ${r1(r.median)} p95 ${r1(r.p95)} p99 ${r1(r.p99)} worst ${r1(r.worst)}  long ${r.longTasks}/${r1(r.longTaskMs)}ms  sim ${r1(r.simMs)} prep ${r.prepared} px ${r.pixelRatio} anim ${Math.round(r.animMs)}` + (process.env.PERF_DEBUG ? `\n      long@ ${JSON.stringify(r.longAt)} slow ${JSON.stringify(r.slowFrames)}` : ""));
  await context.close();
}
await browser.close();

const summary = {};
for (const label of ["first", "second", "third", "nextTurn"]) {
  const rs = results.flatMap((t) => t.rolls.filter((r) => r.label === label));
  const agg = (key) => {
    const v = rs.map((r) => r[key]).filter((x) => typeof x === "number").sort((a, b) => a - b);
    return { median: r1(q(v, 0.5)), min: r1(v[0] ?? 0), max: r1(v.at(-1) ?? 0) };
  };
  summary[label] = { n: rs.length, tapToFirstFrame: agg("tapToFirstFrame"), avg: agg("avg"), median: agg("median"), p95: agg("p95"), p99: agg("p99"), worst: agg("worst"), longTasks: agg("longTasks"), simMs: agg("simMs"), animMs: agg("animMs"), prepared: rs.filter((r) => r.prepared).length, pixelRatio: [...new Set(rs.map((r) => r.pixelRatio))] };
}
const loads = results.map((r) => r.loadMs).sort((a, b) => a - b);
const heaps = results.map((r) => r.heapMB).sort((a, b) => a - b);
const report = { cpu: CPU, wait: WAIT, gap: GAP, trials: TRIALS, device: "Pixel 7 emulation (412x915, DPR 2.625), headless Chromium, SwiftShader", loadMs: { median: q(loads, 0.5), min: loads[0], max: loads.at(-1) }, heapMB: { median: q(heaps, 0.5) }, summary, results };
console.log(JSON.stringify({ loadMs: report.loadMs, heapMB: report.heapMB, summary }, null, 1));
if (OUT) writeFileSync(OUT, JSON.stringify(report, null, 1));
stop();
process.exit(0);

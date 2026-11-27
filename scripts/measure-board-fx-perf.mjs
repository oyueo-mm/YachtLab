#!/usr/bin/env node
/**
 * Board / dice effect cost probe (A1, 2026-11-27). Same script for "before" (main) and "after" builds.
 *
 *   npx vite build && node scripts/measure-board-fx-perf.mjs [--dist dist] [--port 4181] [--trials 2]
 *        [--rolls 6] [--idle 3000] [--viewport desktop|phone] [--cpu 1] [--only key,key] [--out file.json]
 *
 * For each equip combo (offline own look, #solo): fresh context → board visible (init time) →
 * idle window (no roll; Lv.2 ambient cost) → `rolls` throws in 2 turns (tap→first frame, frame
 * intervals while dice move, long tasks) → CDP metrics (TaskDuration / ScriptDuration per second,
 * JS heap after a forced GC (start of the throws vs after them: growth), DOM nodes, canvas count).
 * `firstRollFrames` = the first throw of the session, `laterRollFrames` = the last third (sustained play). The frame samples are rAF intervals of the page.
 *
 * EMULATION ONLY: headless Chromium with SwiftShader (CPU software GPU), 60 Hz rAF cap. Not a real device;
 * GPU usage is not measurable here (SwiftShader runs on the CPU, so it shows up in TaskDuration).
 */
import { chromium, devices } from "playwright";
import { startPreview } from "./lib/preview-server.mjs";
import { writeFileSync } from "node:fs";

const arg = (name, fallback) => {
  const i = process.argv.indexOf("--" + name);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const DIST = arg("dist", "dist");
const PORT = Number(arg("port", 4181));
const TRIALS = Number(arg("trials", 2));
const ROLLS = Number(arg("rolls", 6));
const IDLE = Number(arg("idle", 3000));
const VIEW = arg("viewport", "desktop");
const CPU = Number(arg("cpu", 1));
const ONLY = arg("only", "");
const OUT = arg("out", "");
const BASE = `http://127.0.0.1:${PORT}/YachtLab/`;

export const COMBOS = {
  default: {},
  "meadow-board-lv3": { board: "board.meadow", boardLv: 3 },
  "storm-board-lv3": { board: "board.storm", boardLv: 3 },
  "space-board-lv3": { board: "board.space", boardLv: 3 },
  "deep_sea-board-lv3": { board: "board.deep_sea", boardLv: 3 },
  "lava-dice3+space3": { dice: "dice.lava", diceLv: 3, board: "board.space", boardLv: 3 },
  "lava-synergy": { dice: "dice.lava", diceLv: 3, board: "board.volcano", boardLv: 3 },
  "thunder-synergy": { dice: "dice.thunder", diceLv: 3, board: "board.storm", boardLv: 3 },
  "meadow-synergy": { dice: "dice.meadow", diceLv: 3, board: "board.meadow", boardLv: 3 },
  "sakura-synergy": { dice: "dice.sakura", diceLv: 3, board: "board.sakura", boardLv: 3 },
};

const preview = await startPreview(DIST, PORT);

const PROBE = () => {
  const w = window;
  w.__probe = { frames: [], long: [], taps: [] };
  const loop = (t) => {
    w.__probe.frames.push(t);
    if (w.__probe.frames.length > 40000) w.__probe.frames.splice(0, 20000);
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
const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return { n: s.length, avg: r1(s.reduce((a, b) => a + b, 0) / Math.max(1, s.length)), p50: r1(q(s, 0.5)), p95: r1(q(s, 0.95)), p99: r1(q(s, 0.99)), worst: r1(s.at(-1) ?? 0), over33: s.filter((x) => x > 33.4).length, over50: s.filter((x) => x > 50).length };
};
const metrics = async (cdp) => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));

async function roll(page) {
  const before = await page.evaluate(() => window.__yachtlabDice?.history.length ?? 0);
  await page.waitForFunction(() => !document.querySelector(".roll-button")?.disabled, null, { timeout: 30000 });
  await page.locator(".roll-button").click();
  await page.waitForFunction((n) => (window.__yachtlabDice?.history.length ?? 0) > n, before, { timeout: 30000 });
  await page.waitForTimeout(120);
  return page.evaluate(() => {
    const p = window.__probe, r = window.__yachtlabDice.last, tap = p.taps.at(-1), end = r.endedAt ?? performance.now();
    const ts = p.frames.filter((t) => t > tap && t <= end + 0.5);
    const iv = [];
    let prev = tap;
    for (const t of ts) (iv.push(t - prev), (prev = t));
    const long = p.long.filter((l) => l.start + l.dur > tap && l.start < end);
    return { iv, firstFrame: r.firstFrameAt ? r.firstFrameAt - tap : null, long: long.length, longMs: long.reduce((a, l) => a + l.dur, 0), animMs: end - (r.firstFrameAt ?? tap), simMs: r.simMs };
  });
}

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
const out = { viewport: VIEW, cpu: CPU, trials: TRIALS, rolls: ROLLS, idleMs: IDLE, env: "headless Chromium + SwiftShader (software GL), 60 Hz rAF cap — emulation, not a real device", combos: {} };
const keys = Object.keys(COMBOS).filter((k) => !ONLY || ONLY.split(",").includes(k));
for (const key of keys) {
  const look = COMBOS[key];
  const agg = { init: [], firstFrame: [], roll: [], idle: [], cpuIdle: [], cpuRoll: [], scriptRoll: [], heap: [], heapGrowth: [], nodes: [], canvases: [], long: [], longMs: [], firstRollIv: [], lateRollIv: [] };
  for (let t = 0; t < TRIALS; t++) {
    const ctx = await browser.newContext(VIEW === "phone" ? { ...devices["Pixel 7"], reducedMotion: "no-preference" } : { viewport: { width: 1366, height: 800 }, reducedMotion: "no-preference" });
    await ctx.route(/workers\.dev|\/api\//, (r) => r.abort());
    await ctx.addInitScript(PROBE);
    await ctx.addInitScript((l) => {
      const u = "u_" + "a".repeat(22);
      localStorage.setItem("yachtlab.session.v1", "s1." + u + "." + "b".repeat(43));
      localStorage.setItem("yachtlab.own-look.v1", JSON.stringify({ account: u, look: { emotes: [], chats: [], ...l } }));
      localStorage.setItem("yachtlab.settings.v1", JSON.stringify({ muted: true }));
    }, look);
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Performance.enable");
    if (CPU > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });
    const t0 = Date.now();
    await page.goto(BASE + "#solo");
    await page.locator(".game-board .roll-button").waitFor();
    agg.init.push(Date.now() - t0);
    await page.waitForTimeout(1500); // lazy chunks, warm-up
    // idle window (no dice moving): ambient board cost
    const m0 = await metrics(cdp);
    const idleFrom = await page.evaluate(() => performance.now());
    await page.waitForTimeout(IDLE);
    const m1 = await metrics(cdp);
    const idleIv = await page.evaluate((from) => {
      const f = window.__probe.frames.filter((t) => t > from);
      return f.slice(1).map((t, i) => t - f[i]);
    }, idleFrom);
    agg.idle.push(...idleIv);
    agg.cpuIdle.push(((m1.TaskDuration - m0.TaskDuration) / (m1.Timestamp - m0.Timestamp)) * 100);
    await cdp.send("HeapProfiler.collectGarbage").catch(() => {});
    const heap0 = (await metrics(cdp)).JSHeapUsedSize;
    let cpuRollT = 0, cpuRollW = 0, scriptT = 0;
    for (let i = 0; i < ROLLS; i++) {
      const a = await metrics(cdp);
      const r = await roll(page);
      const b = await metrics(cdp);
      cpuRollT += b.TaskDuration - a.TaskDuration;
      scriptT += b.ScriptDuration - a.ScriptDuration;
      cpuRollW += b.Timestamp - a.Timestamp;
      agg.roll.push(...r.iv);
      // sustained play: the first throw vs the last third of the session
      if (i === 0) agg.firstRollIv.push(...r.iv);
      else if (i >= Math.floor((ROLLS * 2) / 3)) agg.lateRollIv.push(...r.iv);
      if (r.firstFrame != null) agg.firstFrame.push(r.firstFrame);
      agg.long.push(r.long);
      agg.longMs.push(r.longMs);
      await page.waitForTimeout(400);
      if (i % 3 === 2) {
        // score the first open box to start the next turn
        await page.locator(".score-option").first().click().catch(() => {});
        await page.waitForTimeout(1600);
      }
    }
    agg.cpuRoll.push((cpuRollT / cpuRollW) * 100);
    agg.scriptRoll.push((scriptT / cpuRollW) * 100);
    await page.waitForTimeout(1500);
    await cdp.send("HeapProfiler.collectGarbage").catch(() => {});
    const m2 = await metrics(cdp);
    agg.heap.push(m2.JSHeapUsedSize / 1048576);
    agg.heapGrowth.push((m2.JSHeapUsedSize - heap0) / 1048576);
    agg.nodes.push(m2.Nodes);
    agg.canvases.push(await page.evaluate(() => document.querySelectorAll("canvas").length));
    await ctx.close();
  }
  const mean = (xs) => r1(xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length));
  const res = {
    look,
    initMs: mean(agg.init),
    tapToFirstFrameMs: stats(agg.firstFrame),
    rollFrames: stats(agg.roll),
    firstRollFrames: stats(agg.firstRollIv),
    laterRollFrames: stats(agg.lateRollIv),
    idleFrames: stats(agg.idle),
    cpuIdlePct: mean(agg.cpuIdle),
    cpuRollPct: mean(agg.cpuRoll),
    scriptRollPct: mean(agg.scriptRoll),
    longTasksPerRoll: mean(agg.long),
    longTaskMsPerRoll: mean(agg.longMs),
    heapMB: mean(agg.heap),
    heapGrowthMB: mean(agg.heapGrowth),
    domNodes: mean(agg.nodes),
    canvases: mean(agg.canvases),
  };
  out.combos[key] = res;
  console.log(`${key.padEnd(20)} init ${res.initMs}ms first ${res.tapToFirstFrameMs.p50}ms | roll avg ${res.rollFrames.avg} p95 ${res.rollFrames.p95} p99 ${res.rollFrames.p99} >33 ${res.rollFrames.over33}/${res.rollFrames.n} | idle avg ${res.idleFrames.avg} p95 ${res.idleFrames.p95} | cpu idle ${res.cpuIdlePct}% roll ${res.cpuRollPct}% | heap ${res.heapMB}MB (+${res.heapGrowthMB}) canvases ${res.canvases}`);
}
await browser.close();
if (OUT) writeFileSync(OUT, JSON.stringify(out, null, 1));
preview.stop();
process.exit(0);

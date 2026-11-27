#!/usr/bin/env node
/**
 * Tap → first-frame timeline (A1.1). For each throw: input delay and handler time (Event Timing API),
 * every rAF tick between the tap and the first 3D frame, long tasks in that window, and whether the
 * throw reused pre-computed physics. Emulation only (Pixel 7, CPU throttling, SwiftShader).
 *
 *   node scripts/trace-first-frame.mjs --dist dist [--look '{…}'] [--cpu 4] [--rolls 6]
 */
import { chromium, devices } from "playwright";
import { startPreview } from "./lib/preview-server.mjs";
const arg = (n, f) => { const i = process.argv.indexOf("--" + n); return i > 0 ? process.argv[i + 1] : f; };
const DIST = arg("dist", "dist"), PORT = Number(arg("port", 4192)), CPU = Number(arg("cpu", 4)), ROLLS = Number(arg("rolls", 6));
const LOOK = JSON.parse(arg("look", '{"dice":"dice.lava","diceLv":3,"board":"board.volcano","boardLv":3}'));
const BASE = `http://127.0.0.1:${PORT}/YachtLab/`;
const preview = await startPreview(DIST, PORT);
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
const ctx = await browser.newContext({ ...devices["Pixel 7"], reducedMotion: "no-preference" });
await ctx.route(/workers\.dev|\/api\//, (r) => r.abort());
await ctx.addInitScript((l) => {
  const u = "u_" + "a".repeat(22);
  localStorage.setItem("yachtlab.session.v1", "s1." + u + "." + "b".repeat(43));
  localStorage.setItem("yachtlab.own-look.v1", JSON.stringify({ account: u, look: { emotes: [], chats: [], ...l } }));
  localStorage.setItem("yachtlab.settings.v1", JSON.stringify({ muted: true }));
  const w = window;
  w.__t = { frames: [], long: [], ev: [], taps: [] };
  const loop = (t) => { w.__t.frames.push(t); if (w.__t.frames.length > 20000) w.__t.frames.splice(0, 10000); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  new PerformanceObserver((l) => { for (const e of l.getEntries()) w.__t.long.push([e.startTime, e.duration]); }).observe({ type: "longtask", buffered: true });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) w.__t.ev.push({ name: e.name, start: e.startTime, ps: e.processingStart, pe: e.processingEnd, dur: e.duration }); }).observe({ type: "event", durationThreshold: 16, buffered: true });
  addEventListener("pointerdown", (e) => { if (e.target?.closest?.(".roll-button")) w.__t.taps.push(performance.now()); }, true);
}, LOOK);
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });
await page.goto(BASE + "#solo");
await page.locator(".roll-button").waitFor();
await page.waitForTimeout(2500);
const r = (x) => Math.round(x);
const rows = [];
const QUIET = process.argv.includes("--quiet");
for (let i = 0; i < ROLLS; i++) {
  if (i && i % 3 === 0) {
    // new turn: score through the sheet (desktop table or mobile dialog)
    await page.getByRole("button", { name: "점수판 열기" }).click({ timeout: 2000 }).catch(() => {});
    await page.locator(".score-option:visible").first().click({ timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(1800);
  }
  await page.waitForFunction(() => !document.querySelector(".roll-button")?.disabled, null, { timeout: 30000 });
  const before = await page.evaluate(() => window.__yachtlabDice?.history.length ?? 0);
  await page.locator(".roll-button").click();
  await page.waitForFunction((n) => (window.__yachtlabDice?.history.length ?? 0) > n, before, { timeout: 30000 });
  const x = await page.evaluate(() => {
    const t = window.__t, d = window.__yachtlabDice.last, tap = t.taps.at(-1), first = d.firstFrameAt;
    const frames = t.frames.filter((f) => f > tap - 40 && f <= first + 1).map((f) => Math.round(f - tap));
    const ev = t.ev.filter((e) => e.start >= tap - 2 && e.start < first).map((e) => `${e.name} in+${Math.round(e.ps - e.start)} run${Math.round(e.pe - e.ps)} paint@${Math.round(e.start + e.dur - tap)}`);
    const long = t.long.filter(([s, du]) => s + du > tap && s < first).map(([s, du]) => `${Math.round(s - tap)}+${Math.round(du)}`);
    return { first: first - tap, effect: d.effectStartAt - tap, prepared: d.prepared, prep: d.prep, sim: d.simMs, frames, ev, long };
  });
  rows.push(x);
  if (!QUIET) console.log(`roll ${i}: first ${r(x.first)} ms (effect start +${r(x.effect)}, prepared ${x.prepared} ${x.prep ?? ""}, sim ${r(x.sim)} ms)\n   rAF ticks rel. tap: ${x.frames.join(" ")}\n   events: ${x.ev.join(" | ") || "-"}\n   long tasks: ${x.long.join(" ") || "-"}`);
  await page.waitForTimeout(900);
}
const med = (a) => { const s = [...a].sort((p, q) => p - q); return s.length ? r(s[Math.floor(s.length / 2)]) : "-"; };
const prep = rows.filter((x) => x.prepared), cold = rows.filter((x) => !x.prepared);
console.log(`${JSON.stringify(LOOK)} cpu ${CPU}x: tap→first frame median ${med(rows.map((x) => x.first))} ms (n ${rows.length}); prepared ${prep.length}: median ${med(prep.map((x) => x.first))}, effect start ${med(prep.map((x) => x.effect))}; not prepared ${cold.length}: median ${med(cold.map((x) => x.first))}, sim ${med(cold.map((x) => x.sim))}`);
await browser.close();
process.exit(0);

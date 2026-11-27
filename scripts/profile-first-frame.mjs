#!/usr/bin/env node
/**
 * Where does the time between the roll tap and the first 3D frame go? (A1.1)
 *
 *   npx vite build --minify false --outDir /tmp/prof && node scripts/profile-first-frame.mjs --dist /tmp/prof \
 *       [--look '{"dice":"dice.lava","diceLv":3,"board":"board.volcano","boardLv":3}'] [--cpu 4] [--rolls 6]
 *
 * Pixel 7 emulation, CPU throttling, CDP sampling profiler (100 µs) around each tap. Reports, per tap,
 * tap → first frame and the self time inside that window grouped by function (unminified build keeps
 * names) and by source chunk. Emulation only (SwiftShader), not a real device.
 */
import { chromium, devices } from "playwright";
import { startPreview } from "./lib/preview-server.mjs";

const arg = (n, f) => { const i = process.argv.indexOf("--" + n); return i > 0 ? process.argv[i + 1] : f; };
const DIST = arg("dist", "dist");
const PORT = Number(arg("port", 4191));
const CPU = Number(arg("cpu", 4));
const ROLLS = Number(arg("rolls", 6));
const LOOK = JSON.parse(arg("look", '{"dice":"dice.lava","diceLv":3,"board":"board.volcano","boardLv":3}'));
const TOP = Number(arg("top", 18));
/** "first": tap → first frame; "roll": tap → dice at rest (whole throw). */
const WINDOW = arg("window", "first");
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
  window.__taps = [];
  addEventListener("pointerdown", (e) => { if (e.target?.closest?.(".roll-button")) window.__taps.push(performance.now()); }, true);
}, LOOK);
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });
await cdp.send("Profiler.enable");
await cdp.send("Profiler.setSamplingInterval", { interval: 100 });
await page.goto(BASE + "#solo");
await page.locator(".roll-button").waitFor();
await page.waitForTimeout(2500);

const total = new Map(), byChunk = new Map();
const firsts = [];
for (let i = 0; i < ROLLS; i++) {
  await page.waitForFunction(() => !document.querySelector(".roll-button")?.disabled, null, { timeout: 30000 });
  const before = await page.evaluate(() => window.__yachtlabDice?.history.length ?? 0);
  // raw input at a precomputed point: no locator / actionability script inside the profiled window
  const box = await page.locator(".roll-button").boundingBox();
  await cdp.send("Profiler.start");
  const t0 = Date.now();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const inputMs = Date.now() - t0;
  const rolled = await page.waitForFunction((n) => (window.__yachtlabDice?.history.length ?? 0) > n, before, { timeout: 8000 }).then(() => true, () => false);
  const { profile } = await cdp.send("Profiler.stop");
  if (!rolled) {
    // the turn was over (3 rolls) or the click missed: score and try again without counting this one
    console.log(`  (tap ${i} did not roll — scoring and continuing)`);
    await page.locator(".score-option").first().click({ timeout: 3000 }).catch(() => {});
    await page.getByRole("button", { name: "점수판 열기" }).click({ timeout: 2000 }).catch(() => {});
    await page.locator('[role="dialog"] .score-option').first().click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(1500);
    continue;
  }
  if (WINDOW === "roll") await page.waitForTimeout(50);
  const { tap, first } = await page.evaluate((w) => ({ tap: window.__taps.at(-1), first: w === "roll" ? window.__yachtlabDice.last.endedAt : window.__yachtlabDice.last.firstFrameAt }), WINDOW);
  firsts.push(first - tap);
  // samples → times (profile timestamps are µs on the same monotonic clock as performance.now() * 1000 + offset;
  // align by the first sample, i.e. use relative deltas from the profile start and the tap delay measured in-page)
  const nodes = new Map(profile.nodes.map((n) => [n.id, n]));
  let t = profile.startTime;
  // the window: from the profile start (just before the input) to the first frame (+ the input dispatch)
  const window0 = profile.startTime, windowMs = first - tap + Math.min(inputMs, 40);
  for (let k = 0; k < profile.samples.length; k++) {
    t += profile.timeDeltas[k];
    if ((t - window0) / 1000 > windowMs) break;
    const n = nodes.get(profile.samples[k]);
    const cf = n.callFrame;
    const name = cf.functionName || "(anonymous)";
    if (name === "(idle)" || name === "(program)") continue;
    const file = (cf.url.split("/").pop() || cf.url || "native").replace(/-[\w-]{8}\.js$/, ".js");
    const key = `${name}  [${file}:${cf.lineNumber + 1}]`;
    const dt = profile.timeDeltas[k] / 1000;
    total.set(key, (total.get(key) ?? 0) + dt);
    byChunk.set(file, (byChunk.get(file) ?? 0) + dt);
  }
  await page.waitForTimeout(900);
  if (i % 3 === 2) {
    await page.locator(".score-option").first().click({ timeout: 3000 }).catch(() => {});
    await page.getByRole("button", { name: "점수판 열기" }).click({ timeout: 2000 }).catch(() => {});
    await page.locator('[role="dialog"] .score-option').first().click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(1500);
  }
}
const r1 = (x) => Math.round(x * 10) / 10;
console.log(`look ${JSON.stringify(LOOK)} cpu ${CPU}x — tap→first frame per roll: ${firsts.map(r1).join(", ")} ms`);
console.log("\nself time inside tap→first-frame windows, by chunk (ms, summed over rolls):");
for (const [k, v] of [...byChunk].sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(`  ${r1(v).toString().padStart(7)}  ${k}`);
console.log("\nby function:");
for (const [k, v] of [...total].sort((a, b) => b[1] - a[1]).slice(0, TOP)) console.log(`  ${r1(v).toString().padStart(7)}  ${k}`);
await browser.close();
process.exit(0);

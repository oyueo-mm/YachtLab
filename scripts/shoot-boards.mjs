#!/usr/bin/env node
/**
 * Board level screenshots (A1): every board × Lv.1 / Lv.2 / Lv.3 in a 1-player game (#solo).
 * Lv.1 and Lv.2 at rest (Lv.2 after the environment has moved for 1.2 s); Lv.3 ~0.55 s after a throw
 * (reactions at the real hit points). Optional `--video` records Lv.3 throws per board (webm).
 *
 *   npx vite build && node scripts/shoot-boards.mjs [--out docs/ui/a1-2026-11] [--only board.meadow,…] [--video]
 */
import { chromium } from "playwright";
import { startPreview } from "./lib/preview-server.mjs";
import { mkdirSync } from "node:fs";

const arg = (n, f) => { const i = process.argv.indexOf("--" + n); return i > 0 ? process.argv[i + 1] : f; };
const OUT = arg("out", "docs/ui/a1-2026-11");
const ONLY = arg("only", "");
const VIDEO = process.argv.includes("--video");
const PORT = Number(arg("port", 4190));
const LEVELS = (arg("levels", "1,2,3")).split(",").map(Number);
const BASE = `http://127.0.0.1:${PORT}/YachtLab/`;
const BOARDS = ["board.charcoal", "board.felt", "board.felt_red", "board.felt_blue", "board.felt_purple", "board.felt_sand", "board.navy", "board.christmas", "board.wood_oak", "board.wood_walnut", "board.leather_brown", "board.leather_black", "board.marble", "board.ocean", "board.desert", "board.ice", "board.space", "board.neon", "board.aurora", "board.gold_table", "board.deep_sea", "board.storm", "board.meadow", "board.flower_field", "board.sakura", "board.forest", "board.volcano"];
mkdirSync(OUT, { recursive: true });
const preview = await startPreview("dist", PORT);
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
const look = (extra) => (l) => {
  const u = "u_" + "a".repeat(22);
  localStorage.setItem("yachtlab.session.v1", "s1." + u + "." + "b".repeat(43));
  localStorage.setItem("yachtlab.own-look.v1", JSON.stringify({ account: u, look: { emotes: [], chats: [], ...l } }));
  localStorage.setItem("yachtlab.settings.v1", JSON.stringify({ muted: true }));
};
for (const board of BOARDS.filter((b) => !ONLY || ONLY.split(",").includes(b))) {
  for (const lv of board === "board.charcoal" ? [1] : LEVELS) {
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 760 }, deviceScaleFactor: 1, reducedMotion: "no-preference", ...(VIDEO && lv === 3 ? { recordVideo: { dir: OUT + "/video", size: { width: 1100, height: 760 } } } : {}) });
    await ctx.route(/workers\.dev|\/api\//, (r) => r.abort());
    await ctx.addInitScript(look(), { board, boardLv: lv });
    const page = await ctx.newPage();
    await page.goto(BASE + "#solo");
    const tray = page.locator(".game-board").first();
    await tray.waitFor();
    await page.waitForTimeout(1500);
    const name = `${OUT}/${board.replace("board.", "")}-lv${lv}.png`; // committed copies are converted to JPEG (q80)
    if (lv === 3) {
      await page.locator(".roll-button").click();
      await page.waitForTimeout(VIDEO ? 2600 : 560);
      if (VIDEO) { await page.locator(".roll-button").click(); await page.waitForTimeout(2600); }
    }
    await tray.screenshot({ path: name });
    console.log(name);
    await ctx.close();
  }
}
await browser.close();
process.exit(0);

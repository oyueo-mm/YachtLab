#!/usr/bin/env node
/**
 * Dice material screenshots (FX-1): representative dice at rest after a real throw in a 1-player game
 * (#solo), on the default board unless --board is given. Optional --mid also captures 0.32 s into the throw.
 *
 *   npx vite build && node scripts/shoot-dice.mjs [--out docs/ui/fx1-2026-11/after] [--only dice.gold,…] [--lv 1] [--board board.felt] [--mid] [--dpr 2]
 */
import { chromium } from "playwright";
import { startPreview } from "./lib/preview-server.mjs";
import { mkdirSync } from "node:fs";

const arg = (n, f) => { const i = process.argv.indexOf("--" + n); return i > 0 ? process.argv[i + 1] : f; };
const OUT = arg("out", "docs/ui/fx1-2026-11/after");
const ONLY = arg("only", "");
const LV = Number(arg("lv", 1));
const BOARD = arg("board", "");
const DPR = Number(arg("dpr", 2));
const MID = process.argv.includes("--mid");
const PORT = Number(arg("port", 4196));
const BASE = `http://127.0.0.1:${PORT}/YachtLab/`;
export const DICE = ["dice.classic", "dice.mint", "dice.wood_oak", "dice.marble_white", "dice.marble_black", "dice.frost", "dice.carbon", "dice.ruby", "dice.emerald", "dice.glass_blue", "dice.glass_amber", "dice.silver", "dice.bronze", "dice.gold", "dice.lava", "dice.galaxy", "dice.aurora", "dice.hologram", "dice.neon_pink", "dice.thunder", "dice.meadow", "dice.flower", "dice.sakura", "dice.abyss"];
mkdirSync(OUT, { recursive: true });
const preview = await startPreview("dist", PORT);
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
for (const dice of DICE.filter((d) => !ONLY || ONLY.split(",").includes(d))) {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 760 }, deviceScaleFactor: DPR, reducedMotion: "no-preference" });
  await ctx.route(/workers\.dev|\/api\//, (r) => r.abort());
  await ctx.addInitScript((l) => {
    const u = "u_" + "a".repeat(22);
    localStorage.setItem("yachtlab.session.v1", "s1." + u + "." + "b".repeat(43));
    localStorage.setItem("yachtlab.own-look.v1", JSON.stringify({ account: u, look: { emotes: [], chats: [], ...l } }));
    localStorage.setItem("yachtlab.settings.v1", JSON.stringify({ muted: true, diceQuality: "3d-high" }));
  }, { dice, diceLv: LV, ...(BOARD ? { board: BOARD, boardLv: 1 } : {}) });
  const page = await ctx.newPage();
  await page.goto(BASE + "#solo");
  const tray = page.locator(".game-board").first();
  await tray.waitFor();
  await page.waitForTimeout(1200);
  await page.locator(".roll-button").click();
  const name = `${OUT}/${dice.replace("dice.", "")}-lv${LV}${BOARD ? "-" + BOARD.replace("board.", "") : ""}`;
  if (MID) { await page.waitForTimeout(320); await tray.screenshot({ path: name + "-mid.png" }); }
  await page.waitForTimeout(MID ? 2600 : 2900);
  await tray.screenshot({ path: name + ".png" });
  console.log(name);
  await ctx.close();
}
await browser.close();
await preview?.stop?.();
process.exit(0);

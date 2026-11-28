#!/usr/bin/env node
/**
 * FX-1 review captures: collection synergies (dice + board of the same theme, Lv.3) mid-throw and at rest,
 * and the special moments in the shop preview (yacht, large straight, board win reaction).
 *   npx vite build && node scripts/shoot-moments.mjs [--out dir] [--mattier 0]
 */
import { chromium } from "playwright";
import { startPreview } from "./lib/preview-server.mjs";
import { mkdirSync } from "node:fs";
const arg = (n, f) => { const i = process.argv.indexOf("--" + n); return i > 0 ? process.argv[i + 1] : f; };
const OUT = arg("out", "docs/ui/fx1-2026-11/review"), PORT = Number(arg("port", 4311)), MAT = arg("mattier", "0");
const SYN = [["thunder", "dice.thunder", "board.storm"], ["meadow", "dice.meadow", "board.meadow"], ["flower", "dice.flower", "board.flower_field"], ["sakura", "dice.sakura", "board.sakura"], ["forest", "dice.wood_oak", "board.forest"], ["deepsea", "dice.abyss", "board.deep_sea"], ["lava", "dice.lava", "board.volcano"], ["ice", "dice.frost", "board.ice"], ["space", "dice.galaxy", "board.space"], ["aurora", "dice.aurora", "board.aurora"]];
mkdirSync(OUT, { recursive: true });
await startPreview(arg("dist", "dist"), PORT);
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
const init = (l) => {
  const u = "u_" + "a".repeat(22);
  localStorage.setItem("yachtlab.session.v1", "s1." + u + "." + "b".repeat(43));
  localStorage.setItem("yachtlab.own-look.v1", JSON.stringify({ account: u, look: { emotes: [], chats: [], ...l } }));
  localStorage.setItem("yachtlab.settings.v1", JSON.stringify({ muted: true, diceQuality: "3d-high" }));
  if (l.__mat !== "") sessionStorage.setItem("yachtlab.dice.material", l.__mat);
};
for (const [name, dice, board] of SYN) {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 760 }, deviceScaleFactor: 1, reducedMotion: "no-preference" });
  await ctx.route(/workers\.dev|\/api\//, (r) => r.abort());
  await ctx.addInitScript(init, { dice, diceLv: 3, board, boardLv: 3, __mat: MAT });
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/YachtLab/#solo`);
  const tray = page.locator(".game-board").first();
  await tray.waitFor();
  await page.waitForTimeout(1200);
  await page.locator(".roll-button").click();
  await page.waitForTimeout(450);
  await tray.screenshot({ path: `${OUT}/syn-${name}-mid.png` });
  await page.waitForTimeout(1700);
  await tray.screenshot({ path: `${OUT}/syn-${name}-rest.png` });
  console.log(name);
  await ctx.close();
}
// special moments through the shared preview (shop detail of a Lv.3-capable die / board)
const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 }, deviceScaleFactor: 1, reducedMotion: "no-preference" });
await ctx.route(/workers\.dev|\/api\//, (r) => r.abort());
await ctx.addInitScript(init, { __mat: MAT });
const page = await ctx.newPage();
await page.goto(`http://127.0.0.1:${PORT}/YachtLab/#shop`);
await page.getByRole("tab", { name: /^주사위/ }).click();
await page.getByRole("button", { name: "황금 자세히" }).click();
let dialog = page.getByRole("dialog", { name: "황금 상세" });
await dialog.getByRole("tab", { name: /^Lv\.3/ }).click();
await page.waitForTimeout(2600);
await dialog.getByRole("button", { name: "요트 연출" }).click();
for (const t of [1500, 400, 700]) { await page.waitForTimeout(t); await dialog.locator(".stage-board").screenshot({ path: `${OUT}/moment-yacht-${t}.png` }); }
await dialog.getByRole("button", { name: "스트레이트 연출" }).click();
for (const t of [1500, 400]) { await page.waitForTimeout(t); await dialog.locator(".stage-board").screenshot({ path: `${OUT}/moment-straight-${t}.png` }); }
await page.goto(`http://127.0.0.1:${PORT}/YachtLab/#shop`);
await page.reload();
await page.getByRole("tab", { name: /^보드판/ }).click();
await page.getByRole("button", { name: "오로라 자세히" }).click();
dialog = page.getByRole("dialog", { name: "오로라 상세" });
await dialog.getByRole("tab", { name: /^Lv\.3/ }).click();
await page.waitForTimeout(2600);
await dialog.getByRole("button", { name: "승리 반응" }).click();
for (const t of [300, 700, 1500]) { await page.waitForTimeout(t); await dialog.locator(".stage-board").screenshot({ path: `${OUT}/moment-win-${t}.png` }); }
await browser.close();
process.exit(0);

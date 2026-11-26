/**
 * Captures the 2-player online table (desktop 1366×768, 1920×1080, Pixel 7) against a local Node room
 * server and a running preview (http://127.0.0.1:5173/YachtLab/). Usage:
 *   npx tsx scripts/ui-shots/online-shots.ts <outDir> [baseUrl]
 */
import { chromium, devices, type Page } from "playwright";
import { startOnlineServer } from "../../server/online/server";

const out = process.argv[2] ?? "shots";
const base = process.argv[3] ?? "http://127.0.0.1:5173/YachtLab/";
const origin = new URL(base).origin;
const returning = { cookies: [], origins: [{ origin, localStorage: [{ name: "yachtlab.visited.v1", value: "1" }] }] };

async function nick(page: Page, name: string) {
  const field = page.getByLabel("닉네임", { exact: true });
  if (await field.count()) await field.first().fill(name).catch(() => undefined);
}

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
const only = process.env.SHAPE;
const shapes: [string, object][] = ([
  ["desktop-1366x768", { viewport: { width: 1366, height: 768 } }],
  ["desktop-1920x1080", { viewport: { width: 1920, height: 1080 } }],
  ["mobile-pixel7", devices["Pixel 7"]],
] as [string, object][]).filter(([label]) => !only || label.includes(only));
try {
  for (const [label, shape] of shapes) {
   // A fresh room server per screen size (the server limits room creation per minute).
   const server = await startOnlineServer({ port: 0, dataDir: null, allowedOrigins: [origin], turnTimeoutMs: null });
   const entry = `${base}?online-server=${encodeURIComponent(server.url)}`;
   try {
    const a = await browser.newContext({ ...shape, storageState: returning, reducedMotion: "reduce" } as never);
    const b = await browser.newContext({ viewport: { width: 1280, height: 900 }, storageState: returning, reducedMotion: "reduce" });
    const host = await a.newPage();
    const guest = await b.newPage();
    await host.goto(entry + "#online");
    await nick(host, "방장");
    await host.getByRole("button", { name: "방 만들기", exact: true }).click();
    const code = await host.getByLabel("초대 코드", { exact: true }).innerText();
    await guest.goto(entry + `&room=${code}#online`);
    await nick(guest, "손님");
    await guest.getByRole("button", { name: "입장하기", exact: true }).click();
    await guest.getByRole("heading", { name: "대기실" }).waitFor({ timeout: 60_000 });
    await host.getByRole("list", { name: "참가자" }).getByText("손님").waitFor().catch(() => undefined);
    await host.getByRole("button", { name: "게임 시작", exact: true }).click();
    await host.locator(".roll-button").waitFor();
    if (process.env.DEBUG_SEAT) {
      console.log(label, await host.evaluate(() => [...document.querySelectorAll(".seat-chip-main, .seat-chip-main *")].slice(0, 12).map((n) => {
        const c = getComputedStyle(n);
        const r = n.getBoundingClientRect();
        return `${n.tagName}.${n.className.toString().slice(0, 30)} d=${c.display} pos=${c.position} fd=${c.flexDirection} h=${Math.round(r.height)} w=${Math.round(r.width)}`;
      }).join("\n")));
    }
    await host.waitForTimeout(2500);
    // a few turns so the score sheet has values
    for (let t = 0; t < 2; t++) {
      for (const p of [host, guest]) {
        const roll = p.locator(".roll-button:not([disabled])");
        if (!(await roll.count())) continue;
        await roll.click();
        await p.waitForTimeout(600);
      }
    }
    // One emote from the opponent and one preset line from me, so both bubbles are on the screenshot.
    await guest.locator(".dock-emote").first().click().catch(() => undefined);
    await host.waitForTimeout(300);
    const chat = host.locator(".dock-chat");
    if (await chat.count()) {
      await chat.click();
      await host.locator(".social-lines button").first().click().catch(() => undefined);
    }
    await host.waitForTimeout(700);
    if (process.env.DEBUG_SEAT) console.log(label, "feed", await host.locator(".anchored-feed .feed-msg").count(), JSON.stringify(await host.locator(".dock-state").allInnerTexts()));
    await host.screenshot({ path: `${out}/online-${label}.png` });
    await a.close();
    await b.close();
   } catch (error) {
    console.error(label, error);
   } finally {
    await server.close();
   }
  }
} finally {
  await browser.close();
}

import { returningVisitorState } from "./visitor";
import { expect, test, devices, type BrowserContext, type Browser, type Page } from "@playwright/test";
import { startLocalWorker, type LocalWorker } from "../helpers/wrangler";
import { nick } from "./helpers";

/**
 * A2 in the real online game (isolated local Worker, two guests): chat lines get their meaning-based
 * motion class, bubbles hang under the seat chips without covering dice / roll button / scoreboard, and a
 * heavy cosmetic combination (frame + name effect + equipped bubble + dice rolling on the real 3D table)
 * keeps the frame rate. Guests own no cosmetics, so the cosmetic classes are applied to the live seat DOM
 * (real layout and game loop; the items themselves are covered by the preview page tests).
 * Frame figures are headless Chromium + SwiftShader emulation, not a real device.
 */
let worker: LocalWorker;
const ORIGIN = "http://127.0.0.1:5173";
const contexts: BrowserContext[] = [];
test.beforeAll(async ({}, info) => {
  if (info.project.name === "mobile") return;
  test.setTimeout(120_000);
  worker = await startLocalWorker({ ALLOWED_ORIGINS: ORIGIN, TURN_TIMEOUT_MS: "0", CREATE_PER_MINUTE: "500", JOIN_PER_MINUTE: "500" });
});
test.afterEach(async () => { await Promise.all(contexts.splice(0).map((c) => c.close().catch(() => undefined))); });
test.afterAll(async () => { await worker?.stop(); });
const entry = () => `?online-server=${encodeURIComponent(worker.url)}#online`;
async function device(browser: Browser, phone: boolean): Promise<Page> {
  const ctx = await browser.newContext({ storageState: returningVisitorState(), ...(phone ? devices["Pixel 7"] : { viewport: { width: 1366, height: 900 } }), baseURL: ORIGIN + "/YachtLab/", reducedMotion: "no-preference" });
  contexts.push(ctx);
  return ctx.newPage();
}
const hit = (a: DOMRect, b: DOMRect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

test("온라인 대전: 채팅 문구가 의미별 움직임·말풍선 레이어로 표시되고 점수판·주사위를 가리지 않으며, 고부하 꾸미기 조합에서도 프레임이 유지된다", async ({ browser }, info) => {
  test.skip(info.project.name === "mobile", "두 기기를 한 테스트에서 직접 만든다");
  test.setTimeout(240_000);
  const pc = await device(browser, false);
  const phone = await device(browser, true);
  for (const [p, n] of [[pc, "피씨"], [phone, "폰"]] as const) {
    await p.goto(entry());
    await nick(p, n);
    await p.getByRole("button", { name: "빠른 대전 시작" }).click();
  }
  for (const p of [pc, phone]) await expect(p.locator(".roll-button")).toBeVisible({ timeout: 15_000 });

  // chat: "화이팅!" (cheer). The receiver's seat feed carries the mood class and tier class; the bubble layer is separate.
  await pc.getByRole("button", { name: "채팅·이모티콘" }).click();
  const sheet = pc.getByRole("dialog", { name: "채팅·이모티콘" });
  await expect(sheet.locator(".social-tier").first()).toBeVisible();
  await sheet.getByRole("button", { name: "화이팅!", exact: true }).click();
  const received = phone.locator(".anchored-feed .feed-msg.chat").filter({ hasText: "화이팅!" });
  await expect(received).toBeVisible({ timeout: 8000 });
  await expect(received).toHaveClass(/chat-m-cheer/);
  await expect(received).toHaveClass(/chat-t-basic/);
  expect(await received.evaluate((n) => /bubble-/.test(n.className))).toBe(false);

  // no cover: bubble vs roll button, kept-dice slots, scoreboard (both screens)
  for (const p of [pc, phone]) {
    const o = await p.evaluate(() => {
      const box = (q: string) => document.querySelector(q)?.getBoundingClientRect() ?? null;
      const feed = [...document.querySelectorAll(".anchored-feed .feed-msg")].map((n) => n.getBoundingClientRect());
      // The 3D tray itself is the existing design (bubbles hang from the seat chip over its top corner, D-060); what must stay clear is the roll button, the kept-dice slots and the scoreboard.
      const targets = [".roll-button", ".dice-hold-area, .game-board .die-button", ".scoreboard"].map(box);
      const hit = (a: DOMRect, b: DOMRect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      return feed.some((f) => targets.some((t) => t && hit(f, t)));
    });
    expect(o).toBe(false);
  }

  // heavy combination on the live seat DOM: frame Lv.3 + neon name Lv.3 + a Lv.3 bubble on every feed message
  for (const p of [pc, phone]) {
    await p.evaluate(() => {
      document.querySelectorAll(".seat-chip .player-icon").forEach((n) => n.classList.add("pf-ring-holo", "pf-lv3"));
      document.querySelectorAll(".seat-chip .player-name").forEach((n) => n.classList.add("namefx-neon", "fx-lv3"));
      document.querySelectorAll(".anchored-feed .feed-msg").forEach((n) => n.classList.add("bubble-holo", "bubble-lv3"));
    });
    await expect(p.locator('.seat-chip .player-icon.pf-ring-holo').first()).toBeVisible();
  }
  const measure = async (p: Page) => {
    await p.evaluate(() => { const w = window as unknown as { __f: number[] }; w.__f = []; let last = performance.now(); const loop = (t: number) => { w.__f.push(t - last); last = t; requestAnimationFrame(loop); }; requestAnimationFrame(loop); });
    // roll while the cosmetics run (whoever's turn it is rolls; the other just renders)
    const roll = p.locator(".roll-button");
    if (await roll.isEnabled().catch(() => false)) await roll.click();
    await p.waitForTimeout(3500);
    return p.evaluate(() => { const f = (window as unknown as { __f: number[] }).__f.slice(5).sort((a, b) => a - b); return { n: f.length, avg: f.reduce((a, b) => a + b, 0) / f.length, p95: f[Math.floor(f.length * 0.95)], p99: f[Math.floor(f.length * 0.99)], slow: f.filter((x) => x > 33.5).length }; });
  };
  const stats = { pc: await measure(pc), phone: await measure(phone) };
  console.log("A2-ONLINE-PERF", JSON.stringify(stats));
  expect(stats.pc.avg).toBeLessThan(25);
  expect(stats.phone.avg).toBeLessThan(25);
  await pc.screenshot({ path: "docs/ui/a2-2026-11/after/online-desktop-heavy.png" });
  await phone.screenshot({ path: "docs/ui/a2-2026-11/after/online-phone-heavy.png" });
  void hit;
});

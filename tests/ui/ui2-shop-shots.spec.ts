import { test, type Page, type Route } from "@playwright/test";
import { DEFAULT_LOADOUT, publicLook } from "../../src/economy/live/catalog";

/**
 * UI-2 (상점·인벤토리 개편) before/after screenshots for docs/ui/ui-2-shop/. Only runs with UI2_SHOTS set
 * to the output folder name ("before" or "after") so CI never rewrites images:
 *   UI2_SHOTS=after npx playwright test tests/ui/ui2-shop-shots.spec.ts
 */
const OUT = `docs/ui/ui-2-shop/${process.env.UI2_SHOTS}/`;
const SERVER = "http://127.0.0.1:8799";
const SESSION = "s1.u_" + "a".repeat(22) + "." + "b".repeat(43);
test.skip(!process.env.UI2_SHOTS, "screenshot capture only");

async function member(page: Page, hash: string) {
  const inventory = [
    { id: "dice.thunder", level: 2, via: "coins", at: 1 }, { id: "board.storm", level: 1, via: "coins", at: 2 },
    { id: "dice.mint", level: 1, via: "coins", at: 3 }, { id: "fx.confetti", level: 3, via: "gems", at: 4 },
    { id: "bubble.gold", level: 1, via: "coins", at: 5 }, { id: "profile.crown", level: 1, via: "coins", at: 6 },
  ];
  const loadout = { ...DEFAULT_LOADOUT, dice: "dice.thunder", board: "board.storm", fx: "fx.confetti", bubble: "bubble.gold" };
  const owned = new Map(inventory.map((i) => [i.id, i.level]));
  const snap = { config: "M3i-W30@1", catalogRev: 2, serverTime: Date.parse("2026-11-28T12:00:00+09:00"), wallet: { coins: 2400, gems: 40 }, inventory, slots: { emote: 4, chat: 6 }, loadout, look: publicLook(loadout, owned),
    state: { day: 1, week: 1, rerolls: 0, rewarded: 0, streak: 0, dailyAll: false, weeklyAll: false, daily: [], weekly: [], counters: {}, achievements: [] }, ledger: [] };
  await page.route(SERVER + "/**", (route: Route) => {
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type,authorization" };
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/me/economy") return route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify({ snapshot: snap }) });
    if (path === "/api/me/shop/draw") return route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify({ snapshot: snap, draw: { now: snap.serverTime, remaining: 5, history: [] } }) });
    return route.fulfill({ status: 404, contentType: "application/json", headers: cors, body: JSON.stringify({ error: { code: "NOT_FOUND", message: "-" } }) });
  });
  await page.addInitScript((s) => { localStorage.setItem("yachtlab.session.v1", s); localStorage.setItem("yachtlab.settings.v1", JSON.stringify({ muted: true })); if (location.hash !== "#tour") localStorage.setItem("yachtlab.coach.v1", JSON.stringify({ shop: 1, draw: 1, inventory: 1 })); }, SESSION);
  await page.goto(`?online-server=${encodeURIComponent(SERVER)}#${hash}`);
  await page.waitForTimeout(1200);
}

/** Full-page capture with every lazy thumbnail painted: grow the viewport to the page height first. */
async function full(page: Page, path: string) {
  const size = page.viewportSize()!;
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width: size.width, height: Math.min(height, 6000) });
  await page.waitForTimeout(700);
  await page.screenshot({ path, fullPage: true });
  await page.setViewportSize(size);
}

test("상점·인벤토리 스크린샷", async ({ page }, info) => {
  const tag = info.project.name;
  await member(page, "shop");
  await full(page, `${OUT}${tag}-shop.png`);
  await page.getByRole("tab", { name: /^주사위/ }).click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}${tag}-shop-dice.png` });
  await page.getByRole("button", { name: "번개 자세히" }).first().click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}${tag}-shop-detail.png` });
  await page.keyboard.press("Escape");
  await page.goto(`?online-server=${encodeURIComponent(SERVER)}#draw`);
  await page.waitForTimeout(1200);
  await full(page, `${OUT}${tag}-draw.png`);
  await page.goto(`?online-server=${encodeURIComponent(SERVER)}#inventory`);
  await page.waitForTimeout(1200);
  await full(page, `${OUT}${tag}-inventory.png`);
  const fx = page.getByRole("tab", { name: /^특수 연출/ });
  await fx.click();
  await page.waitForTimeout(600);
  await full(page, `${OUT}${tag}-inventory-fx.png`);
});

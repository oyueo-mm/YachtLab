import { expect, test, devices, type Browser, type Page } from "@playwright/test";
import { startOnlineServer, type RunningOnlineServer } from "../../server/online/server";
import type { DiceSource } from "../../src/online/dice-source";
import { SEEDS, fixSeed } from "./helpers";

/** Sound requests on this page (names), as logged by src/sound.ts. */
const sounds = (page: Page) => page.evaluate(() => ((window as unknown as { __yachtlabSound?: { log: { name: string }[] } }).__yachtlabSound?.log ?? []).map((e) => e.name));
const yachts = (page: Page) => page.evaluate(() => ((window as unknown as { __yachtlabYacht?: unknown[] }).__yachtlabYacht ?? []).length);

test("요트가 나오면 점수 칸 선택 전에도 자동으로 강조하고(한 번만), 점수는 자동 기록하지 않는다", async ({ page }) => {
  await fixSeed(page, SEEDS.yacht);
  await page.goto("#play");
  await page.getByRole("button", { name: "주사위 굴리기" }).click();
  await expect(page.locator(".yacht-flash")).toContainText("요트!");
  expect(await yachts(page)).toBe(1);
  expect(await sounds(page)).toContain("yachtHit");
  const mobile = (page.viewportSize()?.width ?? 1024) <= 760;
  if (mobile) {
    await expect(page.locator(".mobile-score-button")).toHaveClass(/yacht-ready/);
    await expect(page.locator(".mobile-score-button")).toContainText("요트! 점수 기록");
    await page.getByRole("button", { name: "점수판 열기" }).click();
    await expect(page.getByRole("dialog", { name: "점수판" }).locator('[data-category="yacht"]')).toHaveClass(/yacht-ready/);
    await page.getByRole("button", { name: "점수판 닫기" }).click();
  } else await expect(page.locator('.scoreboard tr[data-category="yacht"]')).toHaveClass(/yacht-ready/);
  // the flash does not block play: the dice and the roll button stay usable
  await expect(page.locator(".roll-button")).toBeEnabled();
  // it fades and is not replayed by re-renders
  await expect(page.locator(".yacht-flash")).toHaveCount(0, { timeout: 4000 });
  if (mobile) {
    await page.getByRole("button", { name: "점수판 열기" }).click();
    await page.getByRole("button", { name: "점수판 닫기" }).click();
  }
  expect(await yachts(page)).toBe(1);
  // nothing was recorded automatically
  await expect(page.locator('.scoreboard [data-category="yacht"] .fixed-score')).toHaveCount(0);
  expect(await page.evaluate(() => document.querySelectorAll(".fixed-score").length)).toBe(0);
});

test("효과음 끄기 설정은 새로고침 후에도 유지되고, 꺼져 있으면 소리를 재생하지 않는다", async ({ page }) => {
  await fixSeed(page, SEEDS.yacht);
  await page.goto("#home");
  await page.getByRole("button", { name: "효과음 끄기" }).click();
  await page.goto("#play");
  await page.reload(); // a new page load: the saved setting is read again
  await expect(page.getByRole("button", { name: "효과음 켜기" })).toBeVisible();
  await page.getByRole("button", { name: "주사위 굴리기" }).click();
  await expect(page.locator(".yacht-flash")).toBeVisible();
  const log = await page.evaluate(() => (window as unknown as { __yachtlabSound: { log: { name: string; played: boolean }[] } }).__yachtlabSound.log);
  expect(log.length).toBeGreaterThan(0);
  expect(log.every((e) => !e.played)).toBe(true);
});

/* ------------------------------------------------------------- online ------------------------------------------------------------- */

let server: RunningOnlineServer;
/** First roll of the match is a yacht (fours), then fair dice. */
function firstRollYacht(): DiceSource {
  let n = 0;
  return { rollDie: () => (n++ < 5 ? 4 : 1 + (crypto.getRandomValues(new Uint8Array(1))[0] % 6)) };
}
test.beforeAll(async ({}, testInfo) => {
  if (testInfo.project.name === "mobile") return;
  server = await startOnlineServer({ port: 0, dataDir: null, allowedOrigins: ["http://127.0.0.1:5173"], turnTimeoutMs: null, dice: firstRollYacht() });
});
test.afterAll(async () => {
  await server?.close();
});
const entry = (room?: string) => `?online-server=${encodeURIComponent(server.url)}${room ? `&room=${room}` : ""}#online`;
async function device(browser: Browser, phone = false) {
  const ctx = await browser.newContext({ ...(phone ? devices["Pixel 7"] : { viewport: { width: 1280, height: 900 } }), baseURL: "http://127.0.0.1:5173/YachtLab/", reducedMotion: "reduce" });
  return ctx.newPage();
}

test("온라인: 상대 입장 효과음은 새 입장에만 한 번, 재접속·새로고침·첫 화면에서는 없음 / 요트 강조는 양쪽 화면에 한 번씩 / 재접속 시 과거 효과음 일괄 재생 없음", async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "두 기기를 한 테스트에서 직접 만든다");
  test.setTimeout(90_000);
  const a = await device(browser);
  const b = await device(browser, true);
  await a.goto(entry());
  await a.getByLabel("닉네임").fill("방장");
  await a.getByRole("button", { name: "방 만들기" }).click();
  await expect(a.getByRole("heading", { name: "대기실" })).toBeVisible();
  const code = (await a.getByLabel("초대 코드").textContent())!.trim();
  expect(await sounds(a)).not.toContain("join"); // own first load: silent
  await b.goto(entry(code));
  await b.getByLabel("닉네임").fill("손님");
  await b.getByRole("button", { name: "입장하기" }).click();
  await expect(a.getByRole("list", { name: "참가자" })).toContainText("손님");
  await expect.poll(async () => (await sounds(a)).filter((n) => n === "join").length).toBe(1);
  expect(await sounds(b)).not.toContain("join"); // the joiner does not hear itself
  // the guest refreshes (reconnect): not a new arrival
  await b.reload();
  await expect(b.getByText("방장이 게임을 시작하면 바로 시작돼요.")).toBeVisible();
  await a.waitForTimeout(500);
  expect((await sounds(a)).filter((n) => n === "join")).toHaveLength(1);
  // the host refreshes: the guest who is already there is not announced again
  await a.reload();
  await expect(a.getByRole("list", { name: "참가자" })).toContainText("손님");
  await a.waitForTimeout(400);
  expect(await sounds(a)).not.toContain("join");

  // yacht on the first roll: both screens flag it once, nobody scores automatically
  await a.getByRole("button", { name: "게임 시작" }).click();
  await a.locator(".roll-button").click();
  for (const p of [a, b]) await expect(p.locator(".yacht-flash")).toContainText("요트!");
  expect(await yachts(a)).toBe(1);
  expect(await yachts(b)).toBe(1);
  await expect(a.locator('.scoreboard tr[data-category="yacht"]')).toHaveClass(/yacht-ready/);
  await expect(b.locator(".fixed-score")).toHaveCount(0);
  // the opponent refreshes: the yacht is still visible in the dice, but the flash is not replayed
  await b.reload();
  await expect(b.locator(".game-board .die-button").first()).toBeVisible();
  await b.waitForTimeout(600);
  expect(await yachts(b)).toBe(0);
  // A scores; then B (after a turn) refreshes: past score sounds are not replayed as a burst
  await a.locator('.scoreboard [data-category="yacht"] .score-option').click();
  await expect(b.locator(".roll-button")).toBeEnabled();
  await b.reload();
  await expect(b.locator(".roll-button")).toBeEnabled();
  await b.waitForTimeout(600);
  const after = await sounds(b);
  expect(after.filter((n) => n === "score" || n === "scoreZero" || n === "yacht")).toEqual([]);
});

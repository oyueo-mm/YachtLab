import { returningVisitorState } from "./visitor";
import { expect, test, devices, type Browser, type Page } from "@playwright/test";
import { startOnlineServer, type RunningOnlineServer } from "../../server/online/server";
import type { DiceSource } from "../../src/online/dice-source";
import { SEEDS, fixSeed, nick } from "./helpers";

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

test("라지 스트레이트가 나오면 숫자 순서대로 빛나는 전용 연출·소리가 한 번(요트보다 짧게), 입력은 막지 않고 점수는 자동 기록하지 않는다", async ({ page }) => {
  await fixSeed(page, SEEDS.large);
  await page.goto("#play");
  await page.getByRole("button", { name: "주사위 굴리기" }).click();
  const flash = page.locator(".straight-flash");
  await expect(flash).toContainText("라지 스트레이트");
  const faces = await page.evaluate(() => (window as unknown as { __yachtlabStraight: { values: number[] }[] }).__yachtlabStraight.map((e) => e.values));
  expect(faces).toHaveLength(1);
  expect([[1, 2, 3, 4, 5], [2, 3, 4, 5, 6]]).toContainEqual(faces[0]);
  // the glow goes face by face in that order (staggered delays), one sound, no yacht moment
  const delays = await flash.locator(".straight-die").evaluateAll((els) => els.map((e) => (e as HTMLElement).style.animationDelay));
  expect(delays).toEqual(["0s", "0.09s", "0.18s", "0.27s", "0.36s"]);
  expect((await sounds(page)).filter((n) => n === "straightHit")).toHaveLength(1);
  expect(await sounds(page)).not.toContain("yachtHit");
  await expect(page.locator(".yacht-flash")).toHaveCount(0);
  await expect(page.locator(".roll-button")).toBeEnabled();
  // shorter than the yacht moment (1.1 s vs 1.7 s) and not replayed by re-renders
  await expect(flash).toHaveCount(0, { timeout: 1600 });
  await page.waitForTimeout(400);
  expect((await sounds(page)).filter((n) => n === "straightHit")).toHaveLength(1);
  expect(await page.evaluate(() => document.querySelectorAll(".fixed-score").length)).toBe(0);
});

test("결과 소리 후보는 효과음 시연에서 비교하고 고른 후보가 저장된다 (기본: 밝은 팡파르)", async ({ page }) => {
  await page.goto("#dice-lab");
  const sets = page.getByRole("radiogroup", { name: "결과 소리 후보" });
  await expect(sets.getByRole("radio")).toHaveCount(4);
  await expect(sets.locator("label.checked")).toContainText("밝은 팡파르");
  await sets.getByText("종소리").click();
  await page.getByRole("group", { name: "결과 소리 듣기" }).getByRole("button", { name: "공동 1위" }).click();
  expect(await sounds(page)).toContain("winShared");
  expect(await page.evaluate(() => localStorage.getItem("yachtlab.sound.result"))).toBe("chime");
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
/** Browser contexts made by a test are closed after it (no page keeps sockets open into later tests). */
const contexts: import("@playwright/test").BrowserContext[] = [];
test.afterEach(async () => {
  await Promise.all(contexts.splice(0).map((c) => c.close().catch(() => undefined)));
});
test.afterAll(async () => {
  await server?.close();
});
const entry = (room?: string) => `?online-server=${encodeURIComponent(server.url)}${room ? `&room=${room}` : ""}#online`;
async function device(browser: Browser, phone = false) {
  const ctx = await browser.newContext({ storageState: returningVisitorState(), ...(phone ? devices["Pixel 7"] : { viewport: { width: 1280, height: 900 } }), baseURL: "http://127.0.0.1:5173/YachtLab/", reducedMotion: "reduce" });
  contexts.push(ctx);
  return ctx.newPage();
}

test("온라인: 상대 입장 효과음은 새 입장에만 한 번, 재접속·새로고침·첫 화면에서는 없음 / 요트 강조는 양쪽 화면에 한 번씩 / 재접속 시 과거 효과음 일괄 재생 없음", async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "두 기기를 한 테스트에서 직접 만든다");
  test.setTimeout(90_000);
  const a = await device(browser);
  const b = await device(browser, true);
  await a.goto(entry());
  await nick(a, "방장");
  await a.getByRole("button", { name: "방 만들기" }).click();
  await expect(a.getByRole("heading", { name: "대기실" })).toBeVisible();
  const code = (await a.getByLabel("초대 코드").textContent())!.trim();
  expect(await sounds(a)).not.toContain("join"); // own first load: silent
  await b.goto(entry(code));
  await nick(b, "손님");
  await b.getByRole("button", { name: "입장하기" }).click();
  await expect(a.getByRole("list", { name: "참가자" })).toContainText("손님");
  await expect.poll(async () => (await sounds(a)).filter((n) => n === "join").length).toBe(1);
  expect(await sounds(b)).not.toContain("join"); // the joiner does not hear itself
  await a.getByRole("button", { name: "박수" }).click();
  for (const player of [a, b]) {
    await expect(player.getByRole("img", { name: "박수" }).or(player.locator(".table-feed .feed-text[aria-label=박수]"))).toBeVisible();
    await expect.poll(async () => (await sounds(player)).filter((name) => name === "emote").length).toBe(1);
  }
  await b.getByRole("button", { name: "채팅·이모티콘" }).click();
  await b.getByLabel("다른 사람 메시지 숨기기").check();
  await b.keyboard.press("Escape");
  await a.getByRole("button", { name: "좋아요" }).click();
  await expect.poll(async () => (await sounds(a)).filter((name) => name === "emote").length).toBe(2);
  expect((await sounds(b)).filter((name) => name === "emote")).toHaveLength(1);
  // the guest refreshes (reconnect): not a new arrival
  await b.reload();
  await expect(b.getByText("방장이 게임을 시작하면 바로 시작돼요.")).toBeVisible();
  expect(await sounds(b)).not.toContain("emote");
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

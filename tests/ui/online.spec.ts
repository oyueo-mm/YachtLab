import { expect, test, devices, type Browser, type Page } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startOnlineServer, type RunningOnlineServer } from "../../server/online/server";
import { scoreCategory } from "./helpers";

/**
 * Online Phase 2: two separate browser contexts (= two devices with their own storage) play through
 * a real local WebSocket server started by this file. Nothing external is contacted.
 */
let server: RunningOnlineServer;
let dataDir: string;
test.beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "yachtlab-online-ui-"));
  server = await startOnlineServer({ port: 0, dataDir, allowedOrigins: ["http://127.0.0.1:5173"], turnTimeoutMs: null });
});
test.afterAll(async () => {
  await server?.close();
});

const entry = (room?: string) => `?online-server=${encodeURIComponent(server.url)}${room ? `&room=${room}` : ""}#online`;

async function device(browser: Browser, kind: "desktop" | "phone") {
  const context = await browser.newContext({
    ...(kind === "phone" ? devices["Pixel 7"] : { viewport: { width: 1280, height: 900 } }),
    baseURL: "http://127.0.0.1:5173/YachtLab/",
    reducedMotion: "reduce",
  });
  return context.newPage();
}

async function createAndJoin(browser: Browser) {
  const a = await device(browser, "desktop");
  const b = await device(browser, "phone");
  await a.goto(entry());
  await a.getByLabel("닉네임").fill("민수");
  await a.getByRole("button", { name: "방 만들기" }).click();
  await expect(a.getByRole("heading", { name: "대기실" })).toBeVisible();
  const code = (await a.getByLabel("초대 코드").textContent())!.trim();
  expect(code).toMatch(/^[A-Z2-9]{6}$/);
  // The invite link opens the entry screen with the code filled in and shows whose room it is.
  await b.goto(entry(code));
  await expect(b.getByText("님의 방에 초대받았어요")).toBeVisible();
  await expect(b.getByLabel("초대 코드")).toHaveValue(code);
  await b.getByLabel("닉네임").fill("지민");
  await b.getByRole("button", { name: "입장하기" }).click();
  await expect(b.getByText("방장이 게임을 시작하면 바로 시작돼요.")).toBeVisible();
  await expect(a.getByRole("list", { name: "참가자" })).toContainText("지민");
  return { a, b, code };
}

/** Whoever has an enabled roll button plays one turn (roll → score the first open category). */
async function playTurn(pages: Page[]) {
  let current: Page | null = null;
  await expect(async () => {
    for (const p of pages) if (await p.locator(".roll-button:not(.waiting):enabled").count()) current = p;
    expect(current).not.toBeNull();
  }).toPass({ timeout: 10000 });
  const page = current!;
  await page.locator(".roll-button").click();
  await expect(page.locator(".turn-indicator")).toContainText("나의 차례");
  await expect(page.locator(".board-top b")).toHaveText("1");
  await scoreCategory(page);
  await expect(page.locator(".roll-button.waiting")).toBeVisible();
}

test("두 브라우저가 초대 코드로 입장해 실시간으로 12라운드를 완주한다(고정·재굴림·점수·종료)", async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "두 기기(데스크톱+모바일)를 한 테스트에서 직접 만든다");
  test.setTimeout(180_000);
  const { a, b } = await createAndJoin(browser);
  await expect(b.getByRole("button", { name: "게임 시작" })).toHaveCount(0);
  await a.getByRole("button", { name: "게임 시작" }).click();
  await expect(a.locator(".turn-indicator")).toContainText("나의 차례");
  await expect(b.locator(".roll-button")).toContainText("민수 님의 차례");
  await expect(b.locator(".roll-button")).toBeDisabled();

  // Turn 1: roll, hold the first die (opponent sees the hold live), re-roll: the held die keeps its value.
  await a.locator(".roll-button").click();
  await expect(a.locator(".board-top b")).toHaveText("1");
  const die = a.locator(".die-button").first();
  await expect(die).toBeVisible();
  const firstValue = (await die.getAttribute("aria-label"))!.split(", ")[1];
  await expect(b.locator(".board-top b")).toHaveText("1");
  const opponentDice = await b.locator(".die-button").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")!.split(", ")[1]));
  await die.click();
  await expect(die).toHaveAttribute("aria-pressed", "true");
  await expect(b.locator(".die-button").first()).toHaveAttribute("aria-pressed", "true");
  expect(opponentDice[0]).toBe(firstValue);
  await a.locator(".roll-button").click();
  await expect(a.locator(".board-top b")).toHaveText("2");
  await expect(a.locator(".die-button").first()).toHaveAttribute("aria-label", new RegExp(`, ${firstValue}, 고정됨`));
  await expect(b.locator(".board-top b")).toHaveText("2");
  // Both screens show the same dice, decided by the server.
  const shown = async (p: Page) => p.locator(".die-button").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")!.split(", ")[1]).sort());
  expect(await shown(b)).toEqual(await shown(a));
  await a.locator('.scoreboard [data-category="choice"] .score-option').click();
  await expect(b.locator(".game-feedback")).toContainText("민수 · 초이스");
  await expect(b.locator(".roll-button")).toBeEnabled();

  for (let turn = 1; turn < 24; turn++) await playTurn([a, b]);

  for (const p of [a, b]) await expect(p.locator(".game-result")).toBeVisible();
  const scoreA = (await a.locator(".game-result p").textContent())!.split(":").map((s) => Number(s.trim()));
  const scoreB = (await b.locator(".game-result p").textContent())!.split(":").map((s) => Number(s.trim()));
  expect(scoreB).toEqual([scoreA[1], scoreA[0]]);
  await expect(a.locator(".score-summary [data-seat]")).toHaveCount(2);
  expect(await a.locator(".score-summary [data-seat='0'] strong").textContent()).toContain(String(scoreA[0]));
});

test("새로고침·재접속·연결 끊김 후에도 같은 좌석으로 돌아와 경기를 이어간다", async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "두 기기를 한 테스트에서 직접 만든다");
  test.setTimeout(90_000);
  const { a, b, code } = await createAndJoin(browser);
  await a.getByRole("button", { name: "게임 시작" }).click();
  await a.locator(".roll-button").click();
  await expect(a.locator(".board-top b")).toHaveText("1");

  // Refresh mid-turn: the seat comes back from this browser's storage (the token is never in the URL).
  expect(a.url()).not.toMatch(/token/i);
  await a.reload();
  await expect(a.locator(".turn-indicator")).toContainText("나의 차례");
  await expect(a.locator(".board-top b")).toHaveText("1");
  await expect(a.locator(".roll-button")).toBeEnabled();

  // The opponent's tab goes away (closed app / lost network): the other side is told, play continues,
  // and the same device rejoins its seat by opening the invite link again.
  await b.close();
  await expect(a.getByText("지민 님의 연결이 끊어졌어요")).toBeVisible({ timeout: 15000 });
  await a.locator('.scoreboard [data-category="choice"] .score-option').click();
  await expect(a.locator(".roll-button.waiting")).toBeVisible();
  // A brand-new tab with the invite link goes straight back to the saved seat.
  const again = await b.context().newPage();
  await again.goto(entry(code));
  await expect(again.locator(".roll-button")).toBeEnabled();
  await expect(a.getByText("지민 님의 연결이 끊어졌어요")).toHaveCount(0);
  await expect(again.locator(".score-summary [data-seat='0'] strong")).not.toHaveText(/^0/);
  await again.locator(".roll-button").click();
  await expect(a.locator(".board-top b")).toHaveText("1");

  // Someone else with only the code cannot take a seat.
  const stranger = await device(browser, "desktop");
  await stranger.goto(entry(code));
  await stranger.getByLabel("닉네임").fill("도윤");
  await stranger.getByRole("button", { name: "입장하기" }).click();
  await expect(stranger.getByRole("alert")).toContainText("이미");
});

test("서버 재시작 후에도 저장된 경기가 복구되어 두 사람이 이어서 플레이한다", async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "두 기기를 한 테스트에서 직접 만든다");
  test.setTimeout(90_000);
  const { a, b } = await createAndJoin(browser);
  await a.getByRole("button", { name: "게임 시작" }).click();
  await a.locator(".roll-button").click();
  await a.locator('.scoreboard [data-category="choice"] .score-option').click();
  await expect(b.locator(".roll-button")).toBeEnabled();
  const port = server.port;
  await server.close();
  await expect(a.getByText("연결이 끊어졌어요. 다시 연결하는 중이에요")).toBeVisible({ timeout: 15000 });
  server = await startOnlineServer({ port, dataDir, allowedOrigins: ["http://127.0.0.1:5173"], turnTimeoutMs: null });
  await expect(b.locator(".roll-button")).toBeEnabled({ timeout: 20000 });
  await b.locator(".roll-button").click();
  await expect(a.locator(".board-top b")).toHaveText("1");
  await expect(a.locator(".score-summary [data-seat='0'] strong")).not.toHaveText(/^0/);
});

test("대기실: 닉네임 충돌 안내, 방장 나가기 후 승계, 없는 코드 안내", async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "두 기기를 한 테스트에서 직접 만든다");
  const a = await device(browser, "desktop");
  const b = await device(browser, "phone");
  await a.goto(entry());
  await a.getByLabel("닉네임").fill("하늘");
  await a.getByRole("button", { name: "방 만들기" }).click();
  await expect(a.getByRole("heading", { name: "대기실" })).toBeVisible();
  const code = (await a.getByLabel("초대 코드").textContent())!.trim();
  await b.goto(entry(code));
  await b.getByLabel("닉네임").fill("하늘");
  await b.getByRole("button", { name: "입장하기" }).click();
  await expect(b.getByRole("alert")).toContainText("같은 닉네임");
  await b.getByLabel("닉네임").fill("바다");
  await b.getByRole("button", { name: "입장하기" }).click();
  await expect(a.getByRole("list", { name: "참가자" })).toContainText("바다");
  await a.getByRole("button", { name: "방 나가기" }).click();
  await expect(a.getByRole("heading", { name: "온라인 대전" })).toBeVisible();
  await expect(b.getByRole("button", { name: "게임 시작" })).toBeVisible();
  await expect(b.getByRole("list", { name: "참가자" })).not.toContainText("하늘");
  const c = await device(browser, "desktop");
  await c.goto(entry());
  await c.getByLabel("닉네임").fill("손님");
  await c.getByLabel("초대 코드").fill("ZZZZZZ");
  await c.getByRole("button", { name: "입장하기" }).click();
  await expect(c.getByRole("alert")).toContainText("방을 찾을 수 없어요");
});

test("서버가 설정되지 않은 배포본은 온라인 대전을 '준비 중'으로 안내한다", async ({ page }) => {
  await page.goto("#online");
  await expect(page.getByRole("heading", { name: "온라인 대전은 준비 중이에요" })).toBeVisible();
  // A non-loopback server parameter is ignored (links cannot send players to a foreign server).
  await page.goto("?online-server=https://evil.example#online");
  await expect(page.getByRole("heading", { name: "온라인 대전은 준비 중이에요" })).toBeVisible();
});

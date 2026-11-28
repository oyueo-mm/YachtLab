import { returningVisitorState } from "./visitor";
import { devices, expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { startLocalWorker, type LocalWorker } from "../helpers/wrangler";
import { fakeLogin, startFakeIdp, type FakeIdp } from "../helpers/fake-idp";
import { dayStart } from "../../src/daily/calendar";

/**
 * 오늘의 요트 (LIVE-1) in a real browser against the local Worker (wrangler dev, DAILY flag on, daily clock
 * shifted to 2026-12-03 01:00 KST — loopback only) with a FAKE local sign-in. A second Worker without the
 * flag shows the "준비 중" page (the production state until the operator turns it on).
 */
let worker: LocalWorker;
let off: LocalWorker;
let idp: FakeIdp;
const ORIGIN = "http://127.0.0.1:5173";
const DATE = "2026-12-03";
const contexts: BrowserContext[] = [];
const base = { ALLOWED_ORIGINS: ORIGIN, GOOGLE_CLIENT_ID: "test-client", GOOGLE_CLIENT_SECRET: "test-secret", AUTH_SECRET: "s".repeat(40), APP_URL: ORIGIN + "/YachtLab/" };
test.beforeAll(async () => {
  test.setTimeout(150_000);
  idp = await startFakeIdp();
  [worker, off] = await Promise.all([
    startLocalWorker({ ...base, TEST_OIDC_ISSUER: idp.issuer, DAILY: "on", DAILY_SECRET: "ui-daily-secret-".padEnd(40, "q"), DAILY_TEST_OFFSET_MS: String(dayStart(DATE) + 3600_000 - Date.now()) }),
    startLocalWorker({ ...base, TEST_OIDC_ISSUER: idp.issuer }),
  ]);
});
test.afterEach(async () => {
  await Promise.all(contexts.splice(0).map((c) => c.close().catch(() => undefined)));
});
test.afterAll(async () => {
  await Promise.all([worker?.stop(), off?.stop()]);
  idp?.close();
});
const at = (w: LocalWorker, hash: string) => `?online-server=${encodeURIComponent(w.url)}#${hash}`;
/** Mobile project: Pixel 7 (touch, 412 px); desktop project: 1280 px, unless a width is forced. */
let phoneProject = false;
test.beforeEach(({}, testInfo) => {
  phoneProject = testInfo.project.name === "mobile";
});
async function visitor(browser: Browser, session: string | null, width?: number) {
  const phone = phoneProject || !!width;
  const ctx = await browser.newContext({ storageState: returningVisitorState(), ...(phone ? { ...devices["Pixel 7"], ...(width ? { viewport: { width, height: 700 } } : {}) } : { viewport: { width: 1280, height: 900 } }), baseURL: ORIGIN + "/YachtLab/", reducedMotion: "reduce" });
  if (session) await ctx.addInitScript((s) => localStorage.setItem("yachtlab.session.v1", s), session);
  contexts.push(ctx);
  return ctx.newPage();
}
async function member(sub: string, nickname: string) {
  const session = await fakeLogin(worker.url, idp, sub, ORIGIN);
  await fetch(worker.url + "/api/me/nickname", { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json", authorization: "Bearer " + session }, body: JSON.stringify({ nickname }) });
  return session;
}
async function playOfficial(page: Page) {
  const board = page.getByRole("region", { name: "오늘의 요트 게임 보드" });
  for (let round = 1; round <= 12; round++) {
    await expect(page.locator(".daily-game .round strong")).toContainText(String(round));
    // the first roll of a turn is revealed by the button (already rolled on the server)
    if (round > 1) await board.locator(".roll-button").click();
    await expect(board.locator(".roll-button")).toContainText("2회 남음");
    // one reroll of everything, then record the first open category
    await board.locator(".roll-button").click();
    await expect(board.locator(".roll-button")).toContainText("1회 남음");
    await page.locator(".daily-game .score-option").first().click();
    await expect(page.locator(".daily-sync")).toHaveCount(0);
  }
}

test("플래그가 꺼진 서버에서는 준비 중 안내만 보인다", async ({ browser }) => {
  const page = await visitor(browser, null);
  await page.goto(at(off, "daily"));
  await expect(page.getByRole("heading", { name: "오늘의 요트" })).toBeVisible();
  await expect(page.getByText("준비 중이에요")).toBeVisible();
  await expect(page.locator(".daily-cards")).toHaveCount(0);
});

test("공식 도전 12라운드 → 공식 기록·순위·공유, 연습 잠금 해제, 퍼즐 정답·해설, 게스트 안내", async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  const sub = "daily-ui-" + testInfo.project.name; // one account per project (the official attempt is once a day)
  // guest: cards, sign-in prompt, ranking visible, no official start
  const guest = await visitor(browser, null);
  await guest.goto(at(worker, "daily"));
  await expect(guest.locator(".daily-date")).toContainText(DATE);
  await expect(guest.getByRole("button", { name: "로그인하고 도전하기" })).toBeVisible();

  const page = await visitor(browser, await member(sub, "데일리"));
  await page.goto(at(worker, "daily"));
  await expect(page.getByRole("button", { name: "공식 도전 시작" })).toBeVisible();
  await page.getByRole("button", { name: "공식 도전 시작" }).click();
  await expect(page.locator(".daily-badge-official")).toContainText("공식 기록");
  // a reload in the middle resumes the same attempt
  await page.getByRole("region", { name: "오늘의 요트 게임 보드" }).locator(".roll-button").click();
  await page.reload();
  await page.getByRole("button", { name: /이어서 하기/ }).click();
  await expect(page.getByRole("region", { name: "오늘의 요트 게임 보드" }).locator(".roll-button")).toContainText("1회 남음");
  await page.locator(".daily-game .score-option").first().click();
  await expect(page.locator(".daily-game .round strong")).toContainText("2");
  // finish the remaining 11 rounds
  const board = page.getByRole("region", { name: "오늘의 요트 게임 보드" });
  for (let round = 2; round <= 12; round++) {
    await expect(page.locator(".daily-game .round strong")).toContainText(String(round));
    await board.locator(".roll-button").click();
    await expect(board.locator(".roll-button")).toContainText("2회 남음");
    await page.locator(".daily-game .score-option").first().click();
    await expect(page.locator(".daily-sync")).toHaveCount(0);
  }
  const noOverflow = async () => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await noOverflow(); // finished game screen
  const after = page.getByRole("region", { name: "공식 도전 결과" });
  await expect(after).toContainText("공식 기록");
  await expect(after).toContainText(/1위 \/ [12]명/);
  await after.getByRole("button", { name: "결과 공유" }).click();
  const share = page.getByRole("dialog", { name: "오늘의 요트 결과 공유" });
  await expect(share.locator(".daily-share-text")).toContainText(`오늘의 요트 ${DATE}`);
  await share.getByRole("button", { name: "닫기" }).click();
  await page.getByRole("button", { name: "나가기" }).click();
  // home: finished card, practice unlocked, ranking with my row
  await expect(page.locator(".daily-card.is-done")).toBeVisible();
  await expect(page.getByRole("button", { name: /같은 주사위로 연습/ })).toBeEnabled();
  await expect(page.locator(".daily-rank-list li.me")).toContainText("데일리");
  await expect(page.locator(".daily-records")).toContainText("개인 최고");
  // puzzles: answer the intro one, see the verdict and the explanation table
  await page.getByRole("button", { name: "퍼즐 풀기" }).click();
  const card = page.locator(".daily-puzzle-card");
  await expect(card.locator("> h2")).toBeVisible();
  const choice = card.locator(".daily-choices button").first();
  if (await choice.count()) await choice.click();
  else await card.locator(".score-option").first().click();
  await expect(card.getByRole("region", { name: "해설" })).toBeVisible();
  await expect(card.getByRole("region", { name: "해설" })).toContainText("정답:");
  await expect(page.locator(".daily-level-tabs [aria-selected=true] svg[aria-label]")).toHaveCount(1);
  await noOverflow(); // puzzle explanation table
});

test("좁은 휴대폰(320·360 px)에서도 일일 화면이 가로로 넘치지 않는다", async ({ browser }) => {
  for (const width of [320, 360]) {
    const page = await visitor(browser, null, width);
    await page.goto(at(worker, "daily"));
    await expect(page.locator(".daily-cards")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    // tap targets of the main actions are at least 44 px high on phones
    for (const b of await page.locator(".daily-card button").all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
});

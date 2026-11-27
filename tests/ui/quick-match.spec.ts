import { returningVisitorState } from "./visitor";
import { nick } from "./helpers";
import { expect, test, devices, type Browser, type Page } from "@playwright/test";
import { startLocalWorker, type LocalWorker } from "../helpers/wrangler";

/**
 * Phase 4.5 in real browsers against the local Worker (wrangler dev): quick match between two
 * devices, the in-game tool row on PC widths (chat / emotes / spectate / resign all visible), the
 * public spectating list and a spectator from it. Nothing external is contacted.
 */
let worker: LocalWorker;
test.beforeAll(async ({}, testInfo) => {
  if (testInfo.project.name === "mobile") return;
  test.setTimeout(120_000);
  worker = await startLocalWorker({ ALLOWED_ORIGINS: "http://127.0.0.1:5173", TURN_TIMEOUT_MS: "0", CREATE_PER_MINUTE: "500", JOIN_PER_MINUTE: "500" });
});
/** Browser contexts made by a test are closed after it (no page keeps sockets open into later tests). */
const contexts: import("@playwright/test").BrowserContext[] = [];
test.afterEach(async () => {
  await Promise.all(contexts.splice(0).map((c) => c.close().catch(() => undefined)));
});
test.afterAll(async () => {
  await worker?.stop();
});
const entry = () => `?online-server=${encodeURIComponent(worker.url)}#online`;
async function device(browser: Browser, kind: "desktop" | "phone", width = 1280) {
  const ctx = await browser.newContext({ storageState: returningVisitorState(), ...(kind === "phone" ? devices["Pixel 7"] : { viewport: { width, height: 900 } }), baseURL: "http://127.0.0.1:5173/YachtLab/", reducedMotion: "reduce" });
  contexts.push(ctx);
  return ctx.newPage();
}
async function quick(p: Page, name: string, publicWatch: boolean) {
  await p.goto(entry());
  await expect(p.getByRole("tab", { name: "빠른 대전" })).toHaveAttribute("aria-selected", "true");
  await nick(p, name);
  // quick matches are always public: no checkbox, only a short note before matching
  await expect(p.getByRole("checkbox", { name: /관전방에 공개/ })).toHaveCount(0);
  await expect(p.getByText("빠른 대전은 관전방에 공개돼요")).toBeVisible();
  void publicWatch;
  await p.getByRole("button", { name: "빠른 대전 시작" }).click();
}

test("빠른 대전: 두 기기가 자동으로 매칭되어 경기 화면으로 이동하고, 공개 경기는 관전방에서 바로 볼 수 있다", async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "두 기기를 한 테스트에서 직접 만든다");
  test.setTimeout(120_000);
  const a = await device(browser, "desktop");
  const b = await device(browser, "phone");
  await quick(a, "민수", true);
  await expect(a.getByText("상대를 찾는 중이에요")).toBeVisible();
  await expect(a.getByRole("timer", { name: "매칭 경과 시간" })).toHaveText(/0:0[1-9]/);
  // refresh while waiting: the wait continues with the same ticket
  await a.reload();
  await expect(a.getByText("상대를 찾는 중이에요")).toBeVisible();
  await quick(b, "지민", true);
  await Promise.all([a, b].map(async (page) => {
    const intro = page.getByRole("status", { name: "빠른 대전 매칭 완료" });
    await expect(intro).toContainText("민수");
    await expect(intro).toContainText("지민");
    await expect(intro).toContainText("VS");
    await expect(page.locator(".roll-button")).toBeVisible();
  }));
  await expect(a.locator(".score-summary")).toContainText("민수");
  await expect(a.locator(".score-summary")).toContainText("지민");
  // PC tool row: chat + emotes next to the board, spectate and resign grouped apart, all visible
  for (const name of ["채팅·이모티콘", "관전 설정"]) await expect(a.getByRole("button", { name, exact: true })).toBeVisible();
  await expect(a.getByRole("button", { name: "기권" })).toBeVisible();
  await expect(a.getByRole("group", { name: "이모티콘 보내기" }).locator(".dock-emote")).toHaveCount(4);
  // phone: the Phase 3 row (chat / spectate / resign), emotes inside the panel
  for (const name of ["채팅·이모티콘", "관전 설정"]) await expect(b.getByRole("button", { name, exact: true })).toBeVisible();
  // a quick emote shows on the other screen
  await a.getByRole("group", { name: "이모티콘 보내기" }).getByRole("button", { name: "박수" }).click();
  await expect(b.locator(".table-feed .feed-msg.emote .feed-text")).toHaveText("👏");
  // public spectating list → watch
  const w = await device(browser, "desktop");
  await w.goto(entry());
  await w.getByRole("tab", { name: "관전방" }).click();
  const row = w.getByRole("list", { name: "공개 경기" }).locator("li").first();
  await expect(row).toContainText("민수");
  await expect(row).toContainText("1/12 라운드");
  await row.getByRole("button", { name: "관전하기" }).click();
  await expect(w.getByText(/관전 중/).first()).toBeVisible({ timeout: 15_000 });
  await expect(w.locator(".roll-button")).toHaveCount(0);
  const current = await a.locator(".roll-button").isEnabled() ? a : b;
  const waiting = current === a ? b : a;
  await waiting.keyboard.press("Space");
  await w.keyboard.press("Space");
  await expect(current.locator(".board-top b")).toHaveText("0");
  await current.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await current.keyboard.press("Space");
  await expect(current.locator(".board-top b")).toHaveText("1");
  await current.keyboard.press("ArrowDown");
  await expect(current.locator("tr.score-row-selected")).toHaveAttribute("data-category", "aces");
  await current.keyboard.press("Enter");
  await expect(current.locator(".board-top b")).toHaveText("0");
  await expect(waiting.locator(".roll-button")).toBeEnabled();
});

test("PC 폭별로 방 번호·채팅·이모티콘·관전·기권 버튼이 모두 화면 안에 보인다", async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "데스크톱 폭만 측정한다");
  test.setTimeout(120_000);
  for (const width of [1920, 1366, 1024, 800]) {
    const a = await device(browser, "desktop", width);
    const b = await device(browser, "desktop", width);
    await quick(a, "가" + width, false);
    await quick(b, "나" + width, false);
    await expect(a.locator(".turn-indicator")).toBeVisible({ timeout: 15_000 });
    const inView = async (name: string) => {
      const box = await a.getByRole("button", { name, exact: true }).boundingBox();
      expect(box, `${name} @${width}`).not.toBeNull();
      expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
      expect(box!.y + box!.height).toBeLessThanOrEqual(900);
    };
    await expect(a.locator(".online-code-chip")).toBeVisible();
    for (const name of ["채팅·이모티콘", "관전 설정", "기권"]) await inView(name);
    await a.context().close();
    await b.context().close();
  }
});

test("닉네임은 프로필에서만 바꾸고, 온라인 화면에는 입력창 없이 그 닉네임이 쓰인다 (처음이면 기본 닉네임 자동 생성)", async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "한 기기만 쓴다");
  const p = await device(browser, "phone");
  await p.goto(entry());
  await expect(p.getByLabel("닉네임")).toHaveCount(0);
  await expect(p.locator(".online-nick strong")).toHaveText(/^요트러\d{4}$/);
  await p.getByRole("link", { name: "프로필에서 변경" }).click();
  await p.getByRole("button", { name: "닉네임 바꾸기" }).click();
  await p.getByLabel("닉네임").fill("새닉네임");
  await p.getByRole("button", { name: "저장" }).click();
  await expect(p.getByText("닉네임을 바꿨어요.")).toBeVisible();
  await p.goto(entry());
  await expect(p.locator(".online-nick strong")).toHaveText("새닉네임");
  await p.getByRole("tab", { name: "친구 대전" }).click();
  await expect(p.getByLabel("닉네임")).toHaveCount(0);
  await expect(p.locator(".online-nick strong")).toHaveText("새닉네임");
});


test("사이트에서 이동해도 한 번만 대기하고, 자동 입장 실패 뒤 1인 게임이 그대로 돌아온다", async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "두 기기를 테스트에서 직접 만든다");
  const a = await device(browser, "desktop");
  const b = await device(browser, "phone");
  let queueSockets = 0;
  a.on("websocket", (ws) => { if (ws.url().endsWith("/ws/match")) queueSockets++; });
  await quick(a, "계속대기", true);
  await expect(a.getByText("상대를 찾는 중이에요")).toBeVisible();
  await a.getByRole("button", { name: "최소화" }).click();
  for (const route of ["shop", "inventory", "quests", "achievements", "records", "solo"]) {
    await a.evaluate((to) => { location.hash = to; }, route);
    await expect(a.locator(`main.page-${route}`)).toBeVisible();
    await expect(a.getByRole("button", { name: "빠른 대전 상태 보기" })).toBeVisible();
  }
  await a.locator(".roll-button").click();
  await expect(a.locator(".roll-button")).toContainText("2회 남음");
  await a.routeWebSocket(/\/ws\/[A-Z2-9]{6}$/, (socket) => socket.close({ code: 4001 }));
  await quick(b, "자동입장", true);
  await expect(b.locator(".roll-button")).toBeVisible();
  await expect(a).toHaveURL(/#solo$/);
  await expect(a.locator("aside").getByText(/다시 들어갈 수 없어요/)).toBeVisible();
  await expect(a.locator(".roll-button")).toContainText("2회 남음");
  await expect(a.getByRole("button", { name: "진행 중인 경기로 돌아가기" })).toBeVisible();
  expect(queueSockets).toBe(1);
});

test("구버전 기능 응답에서는 기존 큐로 전역 대기하며 신규 현황을 요청하지 않는다", async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "두 기기를 테스트에서 직접 만든다");
  const a = await device(browser, "desktop");
  const b = await device(browser, "phone");
  const requests: string[] = [];
  for (const page of [a, b]) {
    page.on("request", (request) => requests.push(request.url()));
    await page.route("**/api/features", (route) => route.fulfill({
      json: { quickMatch: true, publicSpectate: true, signIn: false },
    }));
  }
  await quick(a, "호환대기", true);
  await expect(a.getByText("상대를 찾는 중이에요")).toBeVisible();
  await a.getByRole("tab", { name: "관전방" }).click();
  await expect(a.getByText(/지금 공개된 경기가 없어요|라운드/).first()).toBeVisible();
  await quick(b, "호환상대", true);
  await expect(a.locator(".roll-button")).toBeVisible();
  await expect(b.locator(".roll-button")).toBeVisible();
  expect(requests.some((url) => url.endsWith("/api/activity"))).toBe(false);
});

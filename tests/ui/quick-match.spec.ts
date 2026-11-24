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
test.afterAll(async () => {
  await worker?.stop();
});
const entry = () => `?online-server=${encodeURIComponent(worker.url)}#online`;
async function device(browser: Browser, kind: "desktop" | "phone", width = 1280) {
  const ctx = await browser.newContext({ ...(kind === "phone" ? devices["Pixel 7"] : { viewport: { width, height: 900 } }), baseURL: "http://127.0.0.1:5173/YachtLab/", reducedMotion: "reduce" });
  return ctx.newPage();
}
async function quick(p: Page, name: string, publicWatch: boolean) {
  await p.goto(entry());
  await expect(p.getByRole("tab", { name: "빠른 대전" })).toHaveAttribute("aria-selected", "true");
  await p.getByLabel("닉네임").fill(name);
  const box = p.getByRole("checkbox", { name: /관전방에 공개/ });
  if (publicWatch) await box.check();
  await p.getByRole("button", { name: "빠른 대전 시작" }).click();
}

test("빠른 대전: 두 기기가 자동으로 매칭되어 경기 화면으로 이동하고, 공개 경기는 관전방에서 바로 볼 수 있다", async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "두 기기를 한 테스트에서 직접 만든다");
  test.setTimeout(120_000);
  const a = await device(browser, "desktop");
  const b = await device(browser, "phone");
  await quick(a, "민수", true);
  await expect(a.getByText("상대를 찾는 중이에요")).toBeVisible();
  // refresh while waiting: the wait continues with the same ticket
  await a.reload();
  await expect(a.getByText("상대를 찾는 중이에요")).toBeVisible();
  await quick(b, "지민", true);
  for (const p of [a, b]) await expect(p.locator(".roll-button")).toBeVisible({ timeout: 15_000 });
  await expect(a.locator(".score-summary")).toContainText("민수");
  await expect(a.locator(".score-summary")).toContainText("지민");
  // PC tool row: chat + emotes next to the board, spectate and resign grouped apart, all visible
  for (const name of ["채팅·이모티콘", "관전 설정"]) await expect(a.getByRole("button", { name, exact: true })).toBeVisible();
  await expect(a.getByRole("button", { name: "기권" })).toBeVisible();
  await expect(a.getByRole("group", { name: "이모티콘 보내기" }).getByRole("button")).toHaveCount(4);
  // phone: the Phase 3 row (chat / spectate / resign), emotes inside the panel
  for (const name of ["채팅·이모티콘", "관전 설정"]) await expect(b.getByRole("button", { name, exact: true })).toBeVisible();
  // a quick emote shows on the other screen
  await a.getByRole("group", { name: "이모티콘 보내기" }).getByRole("button", { name: "박수" }).click();
  await expect(b.locator(".chip-bubble.emote")).toHaveText("👏");
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
      expect(box!.y).toBeLessThan(900);
    };
    await expect(a.locator(".online-code-chip")).toBeVisible();
    for (const name of ["채팅·이모티콘", "관전 설정", "기권"]) await inView(name);
    await a.context().close();
    await b.context().close();
  }
});

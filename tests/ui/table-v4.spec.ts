import { returningVisitorState } from "./visitor";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { startOnlineServer } from "../../server/online/server";
import { nick } from "./helpers";

/**
 * Regression tests for issues players reported more than once (D-060):
 *  - the 1:1 online score sheet must not scroll: all 12 rows, the upper bonus and the total are on
 *    screen at 1366×768 and 1920×1080, and recording a score does not move the page;
 *  - seats sit on the board in seat colours (me red / opponent blue, plus "나" and the side);
 *  - the default profile picture is a person silhouette, not a die.
 */
test.beforeEach(({}, info) => test.skip(info.project.name === "mobile", "두 브라우저를 테스트 안에서 직접 만든다"));

async function table(browser: Browser, baseURL: string, viewport: { width: number; height: number }) {
  const origin = new URL(baseURL).origin;
  const server = await startOnlineServer({ port: 0, dataDir: null, allowedOrigins: [origin], turnTimeoutMs: null });
  const a = await browser.newContext({ storageState: returningVisitorState(), baseURL, viewport, reducedMotion: "reduce" });
  const b = await browser.newContext({ storageState: returningVisitorState(), baseURL, viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  const host = await a.newPage();
  const guest = await b.newPage();
  const entry = `?online-server=${encodeURIComponent(server.url)}`;
  await host.goto(entry + "#online");
  await nick(host, "방장");
  await host.getByRole("button", { name: "방 만들기", exact: true }).click();
  const lobbyCode = host.getByRole("region", { name: "대기실" }).getByLabel("초대 코드", { exact: true });
  await expect(lobbyCode).toHaveText(/^[A-Z0-9]{6}$/);
  const code = await lobbyCode.innerText();
  await guest.goto(entry + `&room=${code}#online`);
  await nick(guest, "손님");
  await guest.getByRole("button", { name: "입장하기", exact: true }).click();
  await expect(guest.getByRole("heading", { name: "대기실" })).toBeVisible();
  await expect(host.getByRole("list", { name: "참가자" })).toContainText("손님");
  await host.getByRole("button", { name: "게임 시작", exact: true }).click();
  await expect(host.locator(".roll-button")).toBeVisible();
  return { host, guest, close: async () => { await a.close(); await b.close(); await server.close(); } };
}

async function sheetFits(page: Page) {
  return page.evaluate(() => {
    const sheet = document.querySelector<HTMLElement>(".game-grid > .scoreboard")!;
    const style = getComputedStyle(sheet);
    const rows = [...sheet.querySelectorAll("tbody tr[data-category], tr.bonus-row, tr.total-row")];
    return {
      rows: rows.filter((r) => r.matches("[data-category]")).length,
      scrolls: sheet.scrollHeight > sheet.clientHeight + 1 && /auto|scroll/.test(style.overflowY),
      offscreen: rows.filter((r) => r.getBoundingClientRect().bottom > innerHeight + 1).length,
    };
  });
}

for (const viewport of [{ width: 1366, height: 768 }, { width: 1920, height: 1080 }]) {
  test(`1:1 온라인 점수판은 ${viewport.width}×${viewport.height}에서 스크롤 없이 12족보·보너스·총점을 모두 보여 준다`, async ({ browser, baseURL }) => {
    test.setTimeout(90_000);
    const t = await table(browser, baseURL!, viewport);
    try {
      const { host } = t;
      expect(await sheetFits(host)).toEqual({ rows: 12, scrolls: false, offscreen: 0 });
      // Seats on the board: me (red, "나", left) and the opponent (blue, right).
      const seats = host.locator(".game-board .seat-chip");
      await expect(seats).toHaveCount(2);
      await expect(seats.nth(0)).toHaveAttribute("data-tone", "me");
      await expect(seats.nth(1)).toHaveAttribute("data-tone", "opp");
      await expect(seats.nth(0)).toContainText("나");
      const [me, opp] = await Promise.all([0, 1].map((i) => seats.nth(i).locator(".player-icon").evaluate((n) => getComputedStyle(n).boxShadow)));
      expect(me).not.toEqual(opp);
      expect((await seats.nth(0).boundingBox())!.x).toBeLessThan((await seats.nth(1).boundingBox())!.x);
      // Avatar click: a small popover with the details, nothing pushed around.
      const board = await host.locator(".game-board").boundingBox();
      await seats.nth(1).locator(".seat-chip-main").click();
      await expect(host.getByRole("dialog", { name: /정보/ })).toBeVisible();
      expect(await host.locator(".game-board").boundingBox()).toEqual(board);
      await host.keyboard.press("Escape");
      // Default profile picture: the silhouette, in the header as well.
      await expect(host.locator(".top-profile-button svg.default-avatar")).toBeVisible();
      // Record a score: the page and the sheet stay where they are.
      await host.locator(".roll-button").click();
      const option = host.locator(".scoreboard .score-option").first();
      await expect(option).toBeEnabled();
      const before = { y: await host.evaluate(() => scrollY), sheet: await host.locator(".game-grid > .scoreboard").boundingBox() };
      await option.click();
      await expect(host.locator(".scoreboard .fixed-score")).toHaveCount(1);
      expect({ y: await host.evaluate(() => scrollY), sheet: await host.locator(".game-grid > .scoreboard").boundingBox() }).toEqual(before);
      expect(await sheetFits(host)).toEqual({ rows: 12, scrolls: false, offscreen: 0 });
    } finally {
      await t.close();
    }
  });
}

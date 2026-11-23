import { expect, test, devices, type Browser, type Page } from "@playwright/test";

/**
 * Two separate browsers (desktop + phone) play a full online game on the public GitHub Pages site,
 * which connects to the deployed Worker by itself (no ?online-server parameter).
 */
async function device(browser: Browser, kind: "desktop" | "phone") {
  const ctx = await browser.newContext({ ...(kind === "phone" ? devices["Pixel 7"] : { viewport: { width: 1280, height: 900 } }), reducedMotion: "reduce" });
  return ctx.newPage();
}

async function scoreFirst(page: Page) {
  if ((page.viewportSize()?.width ?? 1024) <= 760) {
    await page.getByRole("button", { name: "점수판 열기" }).click();
    await page.getByRole("dialog", { name: "점수판" }).locator(".score-option").first().click();
  } else await page.locator(".score-option").first().click();
}

test("공개 사이트: 두 브라우저가 초대 링크로 만나 12라운드를 완주한다", async ({ browser }) => {
  const a = await device(browser, "desktop");
  const b = await device(browser, "phone");
  await a.goto("#online");
  await expect(a.getByRole("heading", { name: "온라인 대전" })).toBeVisible();
  await a.getByLabel("닉네임").fill("공개A");
  await a.getByRole("button", { name: "방 만들기" }).click();
  await expect(a.getByRole("heading", { name: "대기실" })).toBeVisible();
  const code = (await a.getByLabel("초대 코드").textContent())!.trim();
  // The link from the waiting room is the public Pages URL with only the room code in it.
  const link = await a.getByLabel("초대 링크").inputValue();
  expect(link).toBe(`https://oyueo-mm.github.io/YachtLab/?room=${code}#online`);
  await b.goto(link);
  await expect(b.getByText("공개A 님의 방에 초대받았어요")).toBeVisible();
  await b.getByLabel("닉네임").fill("공개B");
  await b.getByRole("button", { name: "입장하기" }).click();
  await expect(a.getByRole("list", { name: "참가자" })).toContainText("공개B");
  await a.getByRole("button", { name: "게임 시작" }).click();
  for (let turn = 0; turn < 24; turn++) {
    let current: Page | null = null;
    await expect(async () => {
      for (const p of [a, b]) if (await p.locator(".roll-button:not(.waiting):enabled").count()) current = p;
      expect(current).not.toBeNull();
    }).toPass({ timeout: 20_000 });
    const page = current!;
    await page.locator(".roll-button").click();
    await expect(page.locator(".board-top b")).toHaveText("1");
    if (turn === 0) {
      // hold C → A on one screen: both screens show the same dice, held set and shelf order
      const other = page === a ? b : a;
      for (const id of [2, 0]) await page.locator(`.game-board .die-button[aria-label^="주사위 ${id + 1},"]`).click();
      for (const p of [page, other]) await expect(p.locator("[data-hold-order]")).toHaveAttribute("data-hold-order", "2,0");
      const shown = (p: Page) => p.evaluate(() => [...document.querySelectorAll(".game-board .die-button")].map((d) => d.getAttribute("aria-label")).join("|"));
      await expect.poll(() => shown(other)).toBe(await shown(page));
    }
    if (turn === 1) {
      // refresh mid-turn: same seat, same roll
      await page.reload();
      await expect(page.locator(".board-top b")).toHaveText("1");
    }
    await scoreFirst(page);
    await expect(page.locator(".roll-button.waiting")).toBeVisible();
  }
  for (const p of [a, b]) await expect(p.locator(".game-result")).toBeVisible();
  const sa = (await a.locator(".game-result p").textContent())!.split(":").map((s) => Number(s.trim()));
  const sb = (await b.locator(".game-result p").textContent())!.split(":").map((s) => Number(s.trim()));
  expect(sb).toEqual([sa[1], sa[0]]);
});

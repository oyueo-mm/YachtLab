import { expect, test, type Page } from "@playwright/test";

/** 1인 플레이 (2026-11-27): offline menu, a full 12-round game, records, retry and review. */
const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1440) <= 760;

async function playWithKeys(page: Page) {
  for (let round = 1; round <= 12; round++) {
    await expect(page.locator(".solo-summary .round strong")).toContainText(String(round));
    await page.locator(".roll-button").click();
    await expect(page.locator(".roll-button")).toContainText("2회 남음");
    await page.locator("body").click({ position: { x: 3, y: 300 } });
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(page.locator(".game-feedback")).toBeVisible();
  }
}

test("오프라인 메뉴는 1인 플레이·사람 vs AI·사람 vs 사람 세 가지이고 연습 버튼은 없다", async ({ page }) => {
  await page.goto("#offline");
  const cards = page.locator(".mode-select .mode-card");
  await expect(cards).toHaveCount(3);
  await expect(cards.nth(0)).toContainText("1인 플레이");
  await expect(cards.nth(1)).toContainText("사람 vs AI");
  await expect(cards.nth(2)).toContainText("사람 vs 사람");
  await expect(page.getByRole("button", { name: "한 차례 연습하기" })).toHaveCount(0);
});

test("1인 플레이 12라운드를 끝내면 첫 기록이 저장되고 바로 다시 도전·기록·리뷰로 이어진다", async ({ page }) => {
  test.skip(isMobile(page), "키보드로 빠르게 진행(모바일 배치는 아래 테스트)");
  await page.goto("#offline");
  await page.locator(".mode-card.mode-solo").click();
  await expect(page).toHaveURL(/#solo$/);
  await expect(page.locator(".solo-summary .solo-best strong")).toHaveText("—");
  await page.locator("body").click({ position: { x: 3, y: 300 } });
  await playWithKeys(page);
  const result = page.getByRole("dialog", { name: "첫 기록 완성" });
  await expect(result).toBeVisible({ timeout: 15_000 });
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("yachtlab.solo-records.v1") ?? "[]"));
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({ verification: "client-reported", source: "device" });
  expect(Object.keys(saved[0].card)).toHaveLength(12);
  await expect(result.locator(".solo-final")).toHaveText(saved[0].score + "점");
  await expect(result.getByRole("button", { name: /리뷰/ })).toBeVisible();
  await result.getByRole("button", { name: "바로 다시 도전" }).click();
  await expect(result).toBeHidden();
  await expect(page.locator(".solo-summary .round strong")).toContainText("1");
  await expect(page.locator(".solo-summary .solo-best strong")).toContainText(String(saved[0].score));
  // records page shows the personal record and the replay with a review button
  await page.goto("#records");
  const panel = page.getByRole("region", { name: "1인 플레이 개인 기록" });
  await expect(panel).toContainText("1판");
  await expect(panel).toContainText(String(saved[0].score));
  await expect(page.locator(".record-row").filter({ hasText: "1인 플레이" })).toHaveCount(1);
});

test("1인 플레이 화면은 좁은 휴대폰에서도 가로로 넘치지 않는다", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto("#solo");
  await expect(page.getByRole("region", { name: "1인 플레이 게임 보드" })).toBeVisible();
  await expect(page.locator(".solo-summary")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("회원이 장착한 주사위·보드판은 1인 플레이·AI 대전·로컬 대전에도 보인다(게스트는 기본)", async ({ page }) => {
  await page.route(/workers\.dev|\/api\//, (route) => route.abort());
  await page.goto("#offline");
  await expect(page.locator(".mode-card.mode-solo")).toBeVisible();
  for (const route of ["#solo", "#play", "#pvp"]) {
    await page.goto("about:blank");
    await page.goto(route);
    await expect(page.locator(".game-board")).toBeVisible();
    await expect(page.locator(".game-board.bd-ocean")).toHaveCount(0);
  }
  const user = "u_" + "a".repeat(22);
  await page.evaluate((u) => {
    localStorage.setItem("yachtlab.session.v1", "s1." + u + "." + "b".repeat(43));
    localStorage.setItem("yachtlab.own-look.v1", JSON.stringify({ account: u, look: { dice: "dice.ruby", diceLv: 1, board: "board.ocean", boardLv: 1, bubble: "bubble.basic", profile: "profile.basic", nameFx: "nameFx.none", nameFxLv: 1, fx: "fx.none", fxLv: 1, title: "title.none", emotes: [], chats: [] } }));
  }, user);
  for (const route of ["#solo", "#play", "#pvp"]) {
    await page.goto("about:blank");
    await page.goto(route);
    await expect(page.locator(".game-board.bd-ocean")).toHaveCount(1);
  }
});

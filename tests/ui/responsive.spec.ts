import { expect, test, type Page } from "@playwright/test";

/**
 * Responsive regression (scoreboard clipping report): on tablets, ≤1440px desktops and landscape
 * phones the score table used to be wider than its panel, cutting off the player columns, and the
 * panel could extend below the screen. Every size below must show every category and both players,
 * keep the dice and roll button reachable, and never scroll sideways.
 */
const SIZES: [number, number][] = [
  [320, 568],
  [375, 667],
  [390, 844],
  [430, 932],
  [600, 960],
  [700, 900],
  [768, 1024],
  [820, 1180],
  [900, 600],
  [1024, 768],
  [1024, 1366],
  [1180, 820],
  [1280, 800],
  [1366, 1024],
  [1440, 900],
  [667, 375],
  [844, 390],
  [932, 430],
];

const CATEGORIES = ["aces", "deuces", "threes", "fours", "fives", "sixes", "choice", "four", "full", "small", "large", "yacht"];

async function checkScoreboard(page: Page) {
  const panel = page.locator(".game-grid > .scoreboard");
  if (!(await panel.isVisible())) {
    // Phones: the score sheet opens in one tap and every category can be reached in it.
    await page.getByRole("button", { name: "점수판 열기" }).click();
    const sheet = page.getByRole("dialog", { name: "점수판" });
    for (const c of CATEGORIES) {
      const row = sheet.locator(`[data-category="${c}"]`).first();
      await row.scrollIntoViewIfNeeded();
      await expect(row).toBeInViewport();
    }
    await page.getByRole("button", { name: "점수판 닫기" }).click();
    return;
  }
  const box = (await panel.boundingBox())!;
  const vh = page.viewportSize()!.height;
  expect(box.y + box.height).toBeLessThanOrEqual(Math.max(vh, box.y + 1) + 1); // never taller than the screen
  // both player columns inside the panel
  const heads = await panel.locator("thead th").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().right));
  for (const r of heads) expect(r).toBeLessThanOrEqual(box.x + box.width + 1);
  // every category row reachable (the panel scrolls when the screen is short) with its score cells visible
  for (const c of CATEGORIES) {
    const row = panel.locator(`[data-category="${c}"]`);
    await row.scrollIntoViewIfNeeded();
    const cells = await row.locator("td").evaluateAll((els) => els.map((e) => e.getBoundingClientRect()));
    const p = (await panel.boundingBox())!;
    for (const cell of cells) {
      expect(cell.right).toBeLessThanOrEqual(p.x + p.width + 1);
      expect(cell.width).toBeGreaterThan(30);
    }
    await expect(row).toBeInViewport();
  }
}

for (const [w, h] of SIZES)
  test(`${w}×${h}: 점수판 전체·두 플레이어 열·주사위·굴리기 버튼 접근, 가로 넘침 없음`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "뷰포트를 직접 지정하므로 데스크톱 프로젝트에서 한 번만");
    await page.setViewportSize({ width: w, height: h });
    await page.goto("#play");
    const roll = page.locator(".roll-button");
    await expect(roll).toBeVisible();
    await roll.scrollIntoViewIfNeeded();
    await expect(roll).toBeInViewport({ ratio: 1 });
    await roll.click();
    await expect(page.locator(".die-button").first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    // the redundant "나의 차례 / 굴림 n/3" header is not shown (it stays for screen readers)
    const header = await page.locator(".game-board > .board-top").boundingBox();
    expect(header === null || header.width <= 1).toBe(true);
    await checkScoreboard(page);
    // a score can be recorded in one step from wherever the scoreboard is
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

test("휴대폰: 굴린 뒤 추천 점수를 한 번에 기록(자동 기록 없음), 넓은 화면에는 표시하지 않음", async ({ page }) => {
  await page.goto("#play-setup");
  await page.getByRole("radiogroup", { name: "선공" }).getByText("내가 먼저", { exact: true }).click();
  await page.getByRole("button", { name: "게임 시작" }).click();
  const picks = page.getByRole("group", { name: "추천 점수 바로 기록" });
  await expect(picks).toHaveCount(0); // before the first roll
  await page.getByRole("button", { name: "주사위 굴리기" }).click();
  const mobile = (page.viewportSize()?.width ?? 1024) <= 760;
  if (!mobile) {
    await expect(picks).toBeHidden();
    return;
  }
  await expect(picks).toBeVisible();
  const first = picks.getByRole("button").first();
  const label = (await first.getAttribute("aria-label"))!; // "초이스 21점 기록"
  const points = label.match(/(\d+)점 기록$/)![1];
  await expect(page.locator(".fixed-score")).toHaveCount(0); // nothing recorded until the tap
  await first.click();
  await expect(page.locator(".roll-button")).toBeDisabled(); // turn passed to the AI
  await page.getByRole("button", { name: "점수판 열기" }).click();
  const sheet = page.getByRole("dialog", { name: "점수판" });
  await expect(sheet.locator(".fixed-score").first()).toHaveText(points + "점");
});

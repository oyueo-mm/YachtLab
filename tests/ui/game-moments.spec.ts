import { expect, test } from "@playwright/test";
import { fixSeed, SEEDS, scoreCategory } from "./helpers";

test("실제 네 개의 같은 눈을 확인해 요트에 가까운 굴림을 강조하고 기록 뒤 해제한다", async ({ page }) => {
  await fixSeed(page, SEEDS.four);
  await page.goto("#play");
  const board = page.getByRole("region", { name: "게임 보드" });
  await expect(board).not.toHaveClass(/yacht-near/);
  await page.getByRole("button", { name: "주사위 굴리기" }).click();
  await expect(board).toHaveClass(/yacht-near/);
  await expect(board.locator(".yacht-flash")).toHaveCount(0);
  await scoreCategory(page, "choice");
  await expect(board).not.toHaveClass(/yacht-near/);
  const total = page.locator('.score-summary [data-role="human"] .score-total-pop');
  const desktopTotal = page.locator(".scoreboard .total-row td").first().locator(".score-total-pop");
  await expect(total.or(desktopTotal).first()).toHaveText(/^[1-9]\d*$/);
});

test("연출 중 다시 굴려도 이전 라지 스트레이트 표시가 정해진 시간 안에 사라진다", async ({ page }) => {
  await fixSeed(page, SEEDS.large);
  await page.goto("#play");
  await page.getByRole("button", { name: "주사위 굴리기" }).click();
  const flash = page.locator(".straight-flash");
  await expect(flash).toBeVisible();
  await page.getByRole("button", { name: "다시 굴리기" }).click();
  await expect(flash).toHaveCount(0, { timeout: 1800 });
});

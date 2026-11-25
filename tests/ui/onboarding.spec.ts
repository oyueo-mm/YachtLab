import { expect, test } from "@playwright/test";
import { scoreCategory } from "./helpers";

test("홈에서 연습을 건너뛰고 다시 열어 굴림·킵·재굴림·점수 기록을 직접 완료한다", async ({ page }) => {
  await page.goto("");
  await page.getByRole("button", { name: /처음이라면/ }).click();
  await page.getByRole("button", { name: "건너뛰기" }).click();
  await page.reload();
  await page.getByRole("button", { name: "튜토리얼 다시 보기" }).click();

  await page.getByText("족보와 점수 계산", { exact: true }).click();
  await expect(page.getByText(/63점 이상이면 35점/)).toBeVisible();
  await page.getByRole("button", { name: "주사위 굴리기", exact: true }).click();
  const reroll = page.getByRole("button", { name: "다시 굴리기", exact: true });
  await expect(reroll).toBeDisabled();
  const hold = page.getByRole("region", { name: "연습 보드" }).locator('[data-die-id="0"] .die-button');
  const face = await hold.getAttribute("aria-label");
  await hold.click();
  await expect(hold).toHaveAttribute("aria-pressed", "true");
  await reroll.click();
  await expect(hold).toHaveAttribute("aria-pressed", "true");
  expect((await hold.getAttribute("aria-label"))?.split(", ")[1]).toBe(face?.split(", ")[1]);
  await page.getByRole("button", { name: /초이스 \d+점 기록/ }).click();
  await expect(page.getByText(/초이스 \d+점 기록 완료/)).toBeVisible();
  await page.getByRole("button", { name: "홈으로 가기" }).click();
  await expect(page.getByRole("button", { name: "튜토리얼 다시 보기" })).toBeVisible();
});

test("첫 실제 경기의 안내와 기록 버튼은 점수를 기록하면 사라지고 기록된 점수가 남는다", async ({ page }) => {
  await page.goto("#play");
  await expect(page.getByText("주사위 굴리기를 눌러 시작하세요.")).toBeVisible();
  await page.getByRole("button", { name: "주사위 굴리기" }).click();
  await expect(page.getByText(/주사위를 눌러 킵할 수 있어요/)).toBeVisible();
  await scoreCategory(page, "choice");
  await expect(page.getByText(/주사위를 눌러 킵할 수 있어요/)).toHaveCount(0);
  await expect(page.locator(".game-feedback")).toContainText("초이스");
  if ((page.viewportSize()?.width ?? 1024) <= 760) {
    await page.getByRole("button", { name: "점수판 열기" }).click();
    const dialog = page.getByRole("dialog", { name: "점수판" });
    await dialog.getByRole("button", { name: "나", exact: true }).click();
    const recorded = dialog.locator('[data-category="choice"]');
    await expect(recorded.locator(".fixed-score")).toHaveText(/^\d+점$/);
    await expect(recorded.locator(".score-recorded-label")).toHaveText("기록됨");
    await expect(dialog.locator('[data-category="choice"] .score-option')).toHaveCount(0);
  } else {
    await expect(page.locator('.scoreboard [data-category="choice"] [aria-label$="점 기록됨"]').first()).toBeVisible();
    await expect(page.locator('.scoreboard [data-category="choice"] .score-option')).toHaveCount(0);
  }
});

test("휴대폰 점수표는 기본 한 열과 터치 영역을 유지하는 두 열을 비교할 수 있다", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1024) > 760, "모바일 점수 시트 비교");
  await page.goto("#play");
  await page.getByRole("button", { name: "주사위 굴리기" }).click();
  await page.getByRole("button", { name: "점수판 열기" }).click();
  const dialog = page.getByRole("dialog", { name: "점수판" });
  const groups = dialog.locator(".mobile-quick-groups");
  const listHeight = (await groups.boundingBox())!.height;
  const compact = dialog.getByRole("button", { name: "두 열 보기" });
  await expect(compact).toHaveAttribute("aria-pressed", "false");
  await compact.click();
  await expect(compact).toHaveAttribute("aria-pressed", "true");
  expect((await groups.boundingBox())!.height).toBeLessThan(listHeight * 0.7);
  const row = dialog.locator('[data-category="large"] .mobile-quick-row-live');
  expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await expect(dialog.getByRole("button", { name: "라지 스트레이트 설명" })).toBeVisible();
  await expect(row.getByText("라지 스트레이트", { exact: true })).toBeVisible();
  expect(await dialog.locator(".mobile-score-scroll").evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  await dialog.locator('[data-category="choice"] .score-option').click();
  await expect(dialog).toHaveCount(0);
});

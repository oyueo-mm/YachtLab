import { test, expect } from "@playwright/test";
import { chooseAlgorithm } from "./helpers";
test("커스텀 알고리즘 선택창의 난이도·키보드·외부 클릭·비활성화", async ({
  page,
}) => {
  await page.goto("#play");
  const box = page.getByRole("combobox", { name: "상대 AI" });
  await expect(box).toContainText("매우 어려움");
  expect(await box.evaluate((n) => n.tagName)).toBe("BUTTON");
  await box.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.keyboard.press("Home");
  await page.keyboard.press("Enter");
  await expect(box).toContainText("Random");
  await box.click();
  await expect(
    page.getByRole("option", { name: "DP Expert", exact: true }),
  ).toContainText("매우 어려움");
  const bounds = await page.getByRole("listbox").boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(
    page.viewportSize()!.width,
  );
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await box.click();
  await page.locator(".score-summary").click();
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await chooseAlgorithm(page, "상대 AI", "DP Expert");
  await page.getByRole("button", { name: "주사위 굴리기" }).click();
  await expect(box).toBeDisabled();
});
test("AI 행동은 고정·굴림 상태를 보이고 재대결에서 정리", async ({ page }) => {
  await page.goto("#play");
  await page.getByRole("button", { name: "주사위 굴리기" }).click();
  await page.locator(".score-option").first().click();
  await expect(page.locator(".ai-action-status")).toContainText("굴렸습니다");
  await page.getByRole("button", { name: "재대결", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "주사위 굴리기" }),
  ).toBeEnabled();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

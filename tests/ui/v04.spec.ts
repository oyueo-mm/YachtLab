import { test, expect } from "@playwright/test";
import { chooseAlgorithm,scoreCategory } from "./helpers";
test("사람 대 AI는 정확히 5개 난이도만 보여주고 연구 모델은 관전에 보존",async({page})=>{await page.goto("#play");const select=page.getByRole("combobox",{name:"상대 AI"});await expect(select).toHaveValue("Greedy");await expect(select.locator("option")).toHaveText(["매우 쉬움","쉬움","보통","어려움","매우 어려움"]);await expect(select.locator("option")).toHaveCount(5);await select.selectOption("Random");await expect(select).toHaveValue("Random");await select.selectOption("Win DP v4-D");await expect(select).toHaveValue("Win DP v4-D");await page.getByRole("button",{name:"주사위 굴리기"}).click();await expect(select).toBeDisabled();await page.goto("#watch");await chooseAlgorithm(page,"AI 1","DP Expert");await expect(page.getByRole("combobox",{name:"AI 1"})).toContainText("DP Expert");});
test("AI 행동은 고정·굴림 상태를 보이고 재대결에서 정리", async ({ page }) => {
  await page.goto("#play");
  await page.getByRole("button", { name: "주사위 굴리기" }).click();
  await scoreCategory(page);
  await expect(page.locator(".ai-action-status")).toContainText("굴렸습니다");
  await page.getByRole("button", { name: "재대결", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "주사위 굴리기" }),
  ).toBeEnabled();
  await expect(page.getByRole("alert")).toHaveCount(0);
});
test("백그라운드에서는 AI 행동을 진행하지 않고 복귀하면 재개", async ({
  page,
}) => {
  await page.goto("#play");
  await chooseAlgorithm(page, "상대 AI", "PPO");
  await page.getByRole("button", { name: "주사위 굴리기" }).click();
  await scoreCategory(page);
  await expect(page.locator(".ai-action-status")).toContainText("굴렸습니다");
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const before = await page.locator(".game-board").innerText();
  await page.waitForTimeout(1200);
  expect(await page.locator(".game-board").innerText()).toBe(before);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => false,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.getByRole("button", { name: "주사위 굴리기" })).toBeEnabled(
    { timeout: 20000 },
  );
});

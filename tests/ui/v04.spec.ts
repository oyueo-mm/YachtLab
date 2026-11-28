import { test, expect } from "@playwright/test";
import { chooseAlgorithm, fixSeed, scoreCategory, startAI } from "./helpers";
test("사람 대 AI는 정확히 5개 난이도만 보여주고 연구 모델은 관전에 보존",async({page})=>{await page.goto("#play-setup");const group=page.getByRole("radiogroup",{name:"AI 난이도"});await expect(group.getByRole("radio",{checked:true})).toHaveAttribute("value","Greedy");await expect(group.locator("strong")).toHaveText(["매우 쉬움","쉬움","보통","어려움","매우 어려움"]);await expect(group.getByRole("radio")).toHaveCount(5);await group.getByText("매우 쉬움",{exact:true}).click();await expect(group.getByRole("radio",{checked:true})).toHaveAttribute("value","Random");await group.getByText("매우 어려움",{exact:true}).click();await expect(group.getByRole("radio",{checked:true})).toHaveAttribute("value","Win DP v4-D");await page.getByRole("button",{name:"게임 시작"}).click();await page.getByRole("button",{name:"주사위 굴리기"}).click();await expect(page.getByRole("combobox",{name:"상대 AI"})).toHaveCount(0);await page.goto("#watch");await page.getByRole("dialog",{name:"게임을 나갈까요?"}).getByRole("button",{name:"나가기"}).click();await chooseAlgorithm(page,"AI 1","DP Expert");await expect(page.getByRole("combobox",{name:"AI 1"})).toContainText("DP Expert");});
test("AI 행동은 고정·굴림 상태를 보이고 재대결에서 정리", async ({ page }) => {
  await page.goto("#play");
  await page.getByRole("button", { name: "주사위 굴리기" }).click();
  await scoreCategory(page);
  await expect(page.locator(".ai-action-status")).toContainText("굴렸습니다");
  await page.getByRole("button", { name: "재대결", exact: true }).click();
  await page.getByRole("dialog", { name: "새 경기를 시작할까요?" }).getByRole("button", { name: "재대결" }).click();
  await expect(
    page.getByRole("button", { name: "주사위 굴리기" }),
  ).toBeEnabled();
  await expect(page.getByRole("alert")).toHaveCount(0);
});
test("백그라운드에서는 AI 행동을 진행하지 않고 복귀하면 재개", async ({
  page,
}) => {
  await fixSeed(page, 41); // With the human first, the AI's first five dice form a large straight.
  await startAI(page, { algorithm: "PPO", first: "내가 먼저" });
  await page.getByRole("button", { name: "주사위 굴리기" }).click();
  await scoreCategory(page);
  await expect(page.locator(".ai-action-status")).toContainText("굴렸습니다");
  const straight = page.locator(".straight-flash");
  await expect(straight).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  // Timed effects can expire while play is paused. Keep checking the actual board and the AI caption.
  const board = () => page.locator(".game-board").evaluate((node) => {
    const clone = node.cloneNode(true) as HTMLElement;
    clone.querySelectorAll(".score-fx-label, .score-fx-strip, .yacht-flash, .straight-flash, .a3-zero-toast").forEach((effect) => effect.remove());
    return clone.textContent ?? "";
  });
  const before = await board();
  await expect(straight).toHaveCount(0, { timeout: 1800 });
  await page.waitForTimeout(150);
  expect(await board()).toBe(before);
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

import { test, expect } from "@playwright/test";
import { scoreCategory, startAI, startLocal, withMotion } from "./helpers";

test("모바일은 한 사람씩 보는 점수표에서 탭 한 번으로 기록한다", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 790 });
  await page.goto("#play");
  const open = page.getByRole("button", { name: "점수판 열기" });
  await expect(open).toBeVisible();
  await page.getByRole("button", { name: "주사위 굴리기" }).click();
  await open.click();
  const dialog = page.getByRole("dialog", { name: "점수판" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".bonus-progress")).toHaveCount(1);
  await expect(dialog.locator(".bonus-progress")).toContainText("63점 남음");
  await dialog.locator('[data-category="aces"] .score-option').click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".scoreboard .fixed-score")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "점수 기록 확정" })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("게임 난이도는 상세 설정의 5단계이며 게임 화면은 내부 모델명을 숨긴다", async ({ page }) => {
  await page.goto("#play-setup");
  const levels = page.getByRole("radiogroup", { name: "AI 난이도" }).getByRole("radio");
  await expect(levels).toHaveCount(5);
  await expect(page.getByRole("radiogroup", { name: "AI 난이도" }).locator("strong")).toHaveText(["매우 쉬움", "쉬움", "보통", "어려움", "매우 어려움"]);
  await expect(levels.first()).toHaveAttribute("value", "Random");
  await startAI(page, { algorithm: "Win DP v4-D" });
  await expect(page.getByRole("combobox", { name: "상대 AI" })).toHaveCount(0);
  await expect(page.locator(".game-tools")).not.toContainText("Win DP v4-D");
  await expect(page.locator(".score-summary")).toContainText("매우 어려움");
  await expect(page.getByText("최고 성능 · 벤치마크 기준")).toHaveCount(0);
});

test("매우 어려움은 실제 Win DP v4-D Worker 정책으로 다음 차례를 완료한다", async ({ page }) => {
  await startAI(page, { algorithm: "Win DP v4-D" });
  await page.getByRole("button", { name: "주사위 굴리기" }).click();
  await scoreCategory(page, "aces");
  await expect(page.locator(".ai-action-status")).toContainText("굴렸습니다", { timeout: 30000 });
  await expect(page.locator(".scoreboard .fixed-score")).toHaveCount(2, { timeout: 30000 });
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("로컬 모바일 점수표는 두 플레이어를 전환해 확인한다", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 760 });
  await startLocal(page, { count: 2 });
  await expect(page.getByLabel("플레이어 1 이름")).toHaveCount(0); // names are set before the game
  await page.getByRole("button", { name: "점수판 열기" }).click();
  const dialog = page.getByRole("dialog", { name: "점수판" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".bonus-progress")).toHaveCount(1);
  await dialog.getByRole("button", { name: "플레이어 2" }).click();
  await expect(dialog.locator(".bonus-progress")).toContainText("63점 남음");
  await page.getByRole("button", { name: "점수판 닫기" }).click();
  await expect(dialog).toHaveCount(0);
});

test("내 기록 화면은 기존대로 탐색할 수 있다", async ({ page }) => {
  await page.goto("#records");
  await expect(page.getByRole("heading", { name: "내 기록" })).toBeVisible();
  await expect(page.getByText("AI 대국", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "새로고침" })).toBeEnabled();
});

test("모바일 난이도 선택은 다섯 항목이 세로로 나열된 터치 목록이다", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 790 });
  await page.goto("#play-setup");
  const group = page.getByRole("radiogroup", { name: "AI 난이도" });
  await group.getByText("쉬움", { exact: true }).click();
  await expect(group.getByRole("radio", { checked: true })).toHaveAttribute("value", "PPO");
  const boxes = await group.locator(".level-option").evaluateAll((n) => n.map((e) => e.getBoundingClientRect().height));
  expect(Math.min(...boxes)).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("점수 기록은 별도 확정 없이 한 번으로 완료된다", async ({ page }) => {
  await page.goto("#play");
  await page.getByRole("button", { name: "주사위 굴리기" }).click();
  await scoreCategory(page, "aces");
  await expect(page.locator(".scoreboard .fixed-score")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "점수 기록 확정" })).toHaveCount(0);
});

test("주사위 고정과 해제에서는 굴림 애니메이션이 재시작되지 않는다", async ({ page }) => {
  await withMotion(page);
  await page.goto("#play");
  await page.getByRole("button", { name: "주사위 굴리기" }).click();
  await expect(page.locator(".dice-animating")).toHaveCount(0, { timeout: 4000 });
  const die = page.locator(".die-button").first();
  await die.click();
  await die.click();
  await expect(die).not.toHaveClass(/dice-animating/);
  await expect(die).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "다시 굴리기" }).click();
  await expect(page.locator(".dice-animating")).toHaveCount(5, { timeout: 2000 });
});

test("AI의 실제 굴림에도 같은 주사위 애니메이션이 나타난다", async ({ page }) => {
  await withMotion(page);
  await page.goto("#play");
  await page.getByRole("button", { name: "주사위 굴리기" }).click();
  await expect(page.locator(".dice-animating")).toHaveCount(0, { timeout: 4000 });
  await page.evaluate(() => {
    document.body.dataset.aiRollAnimations = "0";
    new MutationObserver((records) => {
      for (const record of records) {
        const target = record.target;
        if (target instanceof Element && target.classList.contains("die-button") && target.classList.contains("dice-animating"))
          document.body.dataset.aiRollAnimations = String(Number(document.body.dataset.aiRollAnimations || 0) + 1);
      }
    }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["class"] });
  });
  await scoreCategory(page, "aces");
  await expect.poll(() => page.evaluate(() => Number(document.body.dataset.aiRollAnimations || 0)), { timeout: 20000 }).toBeGreaterThan(0);
  await expect(page.locator(".scoreboard .fixed-score")).toHaveCount(2, { timeout: 30000 });
});

test("모바일에서는 중복 점수판을 없애고 상단 게임 도구를 한 줄로 정렬한다", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 790 });
  await page.goto("#play");
  await expect(page.locator(".page-play .game-grid>.scoreboard")).toBeHidden();
  await expect(page.getByRole("button", { name: "점수판 열기" })).toBeVisible();
  const tools = await page
    .locator(".page-play .game-tools")
    .locator(":scope > *")
    .evaluateAll((nodes) =>
      nodes.map((node) => {
        const b = node.getBoundingClientRect();
        return { x: b.x, y: b.y, width: b.width, height: b.height };
      }),
    );
  expect(Math.max(...tools.map((t) => t.y)) - Math.min(...tools.map((t) => t.y))).toBeLessThan(6);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

import { test, expect } from "@playwright/test";
import { chooseAlgorithm } from "./helpers";
test("증류 모델은 홈에서 로드하지 않고 Worker에서 실제 대국 완주", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  await page.goto("");
  expect(requests.some((u) => /distilled-(policy|ppo)-/.test(u))).toBe(false);
  await page.goto("#watch");
  await chooseAlgorithm(page, "AI 1", "Distilled Policy");
  await chooseAlgorithm(page, "AI 2", "Distilled PPO");
  await page.getByRole("button", { name: "새 경기 시작" }).click();
  await expect(
    page.getByRole("button", { name: "일시정지", exact: true }),
  ).toBeEnabled();
  await page.getByLabel("재생 속도", { exact: true }).selectOption("instant");
  await expect(page.locator(".scoreboard .fixed-score")).toHaveCount(24);
  expect(
    requests.filter((u) => /distilled-policy-.*\.js/.test(u)),
  ).toHaveLength(1);
  expect(requests.filter((u) => /distilled-ppo-.*\.js/.test(u))).toHaveLength(
    1,
  );
  expect(requests.some((u) => u.includes("dp-values-"))).toBe(false);
  await expect(page.getByRole("alert")).toHaveCount(0);
});
test("실제 연구 결과 표와 학습 곡선을 열 수 있음", async ({ page }) => {
  await page.goto("#analysis");
  await page
    .getByText("DP 정책 증류 · 실제 학습과 평가 결과", { exact: true })
    .click();
  await expect(page.locator(".research-results tbody tr")).toHaveCount(6);
  await expect(page.locator(".research-results")).toContainText("92.15%");
  await expect(page.locator(".research-results")).toContainText("262,144");
  await expect(
    page.getByRole("link", { name: "실제 학습 곡선", exact: true }),
  ).toHaveAttribute("href", /learning-curves\.svg$/);
});
test("두 학습 모델을 공통 DP 가치와 정책 확률로 분석", async ({ page }) => {
  await page.goto("#analysis");
  for (const name of ["Greedy", "Expectimax"])
    await page.getByLabel(name, { exact: true }).uncheck();
  for (const name of ["Distilled Policy", "Distilled PPO"])
    await page.getByLabel(name, { exact: true }).check();
  await page.getByRole("button", { name: "전략 비교하기" }).click();
  await expect(page.locator(".analysis-answer")).toHaveCount(2);
  await expect(
    page.getByRole("heading", { name: "공통 DP 기준 비교" }),
  ).toBeVisible();
  for (const name of ["Distilled Policy", "Distilled PPO"]) {
    await expect(
      page.locator(`.analysis-answer[data-algorithm="${name}"]`),
    ).toContainText("정책 확률");
    await expect(
      page.locator(`.analysis-answer[data-algorithm="${name}"]`),
    ).toContainText("DP 기대 최종점수");
  }
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.getByLabel("분석 주사위 1").selectOption("6");
  await expect(page.locator(".analysis-answer")).toHaveCount(0);
});

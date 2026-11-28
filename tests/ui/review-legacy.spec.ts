import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { seedReplays } from "./review-fixtures";

// Regression: replays saved in the formats that existed before the A5 screen still open, analyse,
// separate exact from estimated win credit, and reuse the cached analysis.
test.use({ serviceWorkers: "block" });
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../fixtures/review-legacy/${name}`, import.meta.url), "utf8"));

test("이전 형식 AI 기보(v1)는 분석·정확/추정 구분·캐시 재사용이 유지된다", async ({ page }) => {
  test.setTimeout(120_000);
  await seedReplays(page, { ai: [fixture("ai-replay-v1.json")] });
  const row = page.locator(".record-row").filter({ hasText: "옛기록" });
  await row.getByRole("button", { name: "게임 리뷰" }).click();
  const review = page.getByRole("dialog", { name: "게임 리뷰" });
  await expect(review.getByText("분석 완료")).toBeVisible({ timeout: 90_000 });
  await expect(review.getByRole("region", { name: "최종 결과" })).toContainText("옛기록");
  const chart = review.getByRole("group", { name: "승리점수율 그래프" });
  await expect(chart.getByLabel("점 모양 설명")).toContainText("모델 추정");
  await expect(chart.getByLabel("점 모양 설명")).toContainText("정확 종반");
  await expect(chart.locator("circle.estimate").first()).toBeAttached();
  await expect(chart.locator("rect.exact").first()).toBeAttached();
  await expect(chart.locator("output .review-flag")).toHaveText("모델 추정");
  await review.getByRole("button", { name: "마지막", exact: true }).click();
  await expect(chart.locator("output .review-flag")).toHaveText("정확 종반");
  await review.getByRole("button", { name: "돌아가기" }).click();

  let requested = false;
  await page.route("**/assets/product-worker-*.js", async (route) => { requested = true; await route.abort(); });
  await page.reload();
  await row.getByRole("button", { name: "게임 리뷰" }).click();
  await expect(review.getByText("저장된 분석")).toBeVisible({ timeout: 20_000 });
  expect(requested).toBe(false);
});

test("이전 형식 로컬 1:1 기보(v1, 같은 이름)는 좌석으로 구분돼 열린다", async ({ page }) => {
  test.setTimeout(120_000);
  await seedReplays(page, { multi: [fixture("local-multi-v1.json")] });
  await page.locator(".record-row").filter({ hasText: "로컬 대전" }).getByRole("button", { name: "게임 리뷰" }).click();
  const review = page.getByRole("dialog", { name: "게임 리뷰" });
  await expect(review.getByText("분석 완료")).toBeVisible({ timeout: 90_000 });
  const summary = review.getByRole("region", { name: "최종 결과" });
  await expect(summary).toContainText("철수 (선공)");
  await expect(summary).toContainText("철수 (후공)");
  await expect(review.getByRole("list", { name: "행동 타임라인" }).locator("[aria-current=step]")).toHaveCount(1);
  expect(await review.evaluate((surface) => surface.scrollWidth)).toBeLessThanOrEqual(await review.evaluate((surface) => surface.clientWidth));
});

import { expect, test } from "@playwright/test";
import { aiReplay, seedReplays, soloReplay } from "./review-fixtures";

// A5 review screen: 1인 units, failure state, filters, chart ↔ timeline sync and equal names.
test.use({ serviceWorkers: "block" });

test("1인 리뷰는 기대점수(점) 단위의 한 명만 보여 주고 분석 실패와 재시도를 구분한다", async ({ page }) => {
  await seedReplays(page, { solo: [soloReplay()] });
  const workerModule = "**/assets/review-worker-*.js";
  await page.route(workerModule, (route) => route.abort());
  await page.getByRole("button", { name: "게임 리뷰" }).click();
  const review = page.getByRole("dialog", { name: "게임 리뷰" });
  await expect(review.getByRole("alert")).toBeVisible({ timeout: 20_000 });
  await expect(review.getByRole("region", { name: "최종 결과" })).toContainText("1인");
  // Timeline and board stay usable without analysis; no grade is invented.
  await expect(review.getByRole("table", { name: "당시 점수판" })).toBeVisible();
  await expect(review.getByRole("list", { name: "행동 타임라인" }).locator(".review-grade:not(.none)")).toHaveCount(0);
  await page.unroute(workerModule);
  await review.getByRole("button", { name: "분석 다시 시도" }).click();
  await expect(review.getByText("분석 완료")).toBeVisible({ timeout: 30_000 });
  const summary = review.getByRole("region", { name: "최종 결과" });
  await expect(summary.locator(".review-player")).toHaveCount(1);
  await expect(summary).toContainText("점");
  await expect(summary).not.toContainText("%p");
  await expect(review.getByRole("group", { name: "기대 최종점수 그래프" })).toBeVisible();
  await expect(review.getByRole("combobox", { name: "플레이어" })).toHaveCount(0);
  expect(await review.evaluate((surface) => surface.scrollWidth)).toBeLessThanOrEqual(await review.evaluate((surface) => surface.clientWidth));
});

test("필터·하이라이트·그래프가 같은 행동을 가리키고 동명 플레이어를 좌석으로 구분한다", async ({ page }) => {
  test.setTimeout(90_000);
  await seedReplays(page, { ai: [aiReplay(["요트", "요트"], "review-same-names", 91)] });
  await page.getByRole("button", { name: "게임 리뷰" }).click();
  const review = page.getByRole("dialog", { name: "게임 리뷰" });
  await expect(review.getByText("분석 완료")).toBeVisible({ timeout: 60_000 });
  const summary = review.getByRole("region", { name: "최종 결과" });
  await expect(summary).toContainText("요트 (선공)");
  await expect(summary).toContainText("요트 (후공)");
  const timeline = review.getByRole("list", { name: "행동 타임라인" });

  await review.getByRole("radiogroup", { name: "장면 필터" }).getByRole("radio", { name: "실수" }).click();
  const shown = timeline.locator("button .review-grade");
  const count = await shown.count();
  for (let i = 0; i < count; i++) await expect(shown.nth(i)).toHaveText(/^\?/);

  await review.getByRole("radiogroup", { name: "장면 필터" }).getByRole("radio", { name: "불운" }).click();
  await expect(timeline.locator(".review-luck-tag.luck-minus").first()).toBeVisible();

  // A key moment moves the board and the timeline to the same action.
  const moment = review.getByRole("region", { name: "주요 장면" }).locator(".mistakes button").first();
  await moment.click();
  const label = await review.locator(".review-current strong").innerText();
  await review.getByRole("radiogroup", { name: "장면 필터" }).getByRole("radio", { name: "전체" }).click();
  const current = timeline.locator("[aria-current=step]");
  await expect(current).toHaveCount(1);
  expect(await current.getAttribute("aria-label")).toContain(label.split(" · ")[0]);

  // The per-round loss/luck bar selects that round.
  await review.getByRole("radiogroup", { name: "그래프" }).getByRole("radio", { name: "손실·운" }).click();
  await review.getByRole("group", { name: /라운드별 판단 손실과 주사위 운 그래프/ }).getByRole("button", { name: /^5라운드/ }).click();
  await expect(review.locator(".review-current strong")).toContainText("5라운드");
  await expect(review.getByRole("button", { name: /5라운드/ }).and(timeline.locator("[aria-current=step]"))).toHaveCount(1);
  await review.getByRole("radio", { name: "점수", exact: true }).click();
  await expect(review.getByRole("group", { name: "라운드별 점수 그래프" })).toContainText("요트 (후공)");
  expect(await review.evaluate((surface) => surface.scrollWidth)).toBeLessThanOrEqual(await review.evaluate((surface) => surface.clientWidth));
});

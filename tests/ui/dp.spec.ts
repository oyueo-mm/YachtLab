import { test, expect } from "@playwright/test";
async function selectDP(page: import("@playwright/test").Page) {
  await page.getByLabel("Greedy", { exact: true }).uncheck();
  await page.getByLabel("Expectimax", { exact: true }).uncheck();
  await page.getByLabel("DP Expert", { exact: true }).check();
}
test("DP는 필요할 때 로드하고 분석에서 전체 경기 기대값과 후보 차이를 표시", async ({
  page,
}) => {
  const requests: string[] = [],
    errors: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("");
  expect(requests.some((u) => u.includes("dp-values-"))).toBe(false);
  await page.goto("#analysis");
  await selectDP(page);
  expect(requests.some((u) => u.includes("dp-values-"))).toBe(false);
  await page.getByRole("button", { name: "전략 비교하기" }).click();
  await expect(page.locator(".analysis-answer")).toContainText(
    "전체 게임 기대 최종점수",
  );
  await expect(page.locator(".analysis-answer .candidates")).toContainText(
    "최선 대비",
  );
  expect(requests.filter((u) => u.includes("dp-values-"))).toHaveLength(1);
  expect(errors).toEqual([]);
  await page.screenshot({
    path: `test-results/dp-analysis-${test.info().project.name}.png`,
    fullPage: true,
  });
  await page.setViewportSize({ width: 320, height: 740 });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
});
test("DP 관전은 실제 경기 완주와 이전 행동 복원을 지원", async ({ page }) => {
  await page.goto("#watch");
  await page
    .getByRole("combobox", { name: "AI 1", exact: true })
    .selectOption("DP Expert");
  await page
    .getByRole("combobox", { name: "AI 2", exact: true })
    .selectOption("Greedy");
  await page.getByRole("button", { name: "새 경기 시작" }).click();
  await expect(page.getByRole("button", { name: "일시정지" })).toBeEnabled();
  await page.getByRole("button", { name: "일시정지" }).click();
  await page.getByRole("button", { name: "처음부터", exact: true }).click();
  await page.getByRole("button", { name: "다음 행동" }).click();
  const first = await page.locator(".dice-row").innerHTML();
  await page.getByRole("button", { name: "다음 행동" }).click();
  await page.getByRole("button", { name: "이전 행동" }).click();
  expect(await page.locator(".dice-row").innerHTML()).toBe(first);
  await page.getByLabel("재생 속도").selectOption("instant");
  await page.getByRole("button", { name: "재생", exact: true }).click();
  await expect(page.locator(".scoreboard .fixed-score")).toHaveCount(24);
});
test("사람 대전의 DP 로딩은 재대결로 취소 가능", async ({ page }) => {
  let started = false;
  await page.route("**/dp-values-*.gz", async (route) => {
    started = true;
    await new Promise((r) => setTimeout(r, 1500));
    await route.continue().catch(() => {});
  });
  await page.goto("#play");
  await page.getByLabel("상대 AI").selectOption("DP Expert");
  await page.getByRole("button", { name: "주사위 굴리기" }).click();
  await page.locator(".score-option").first().click();
  await expect.poll(() => started).toBe(true);
  await expect(page.locator(".thinking")).toBeVisible();
  await page.getByRole("button", { name: "재대결", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "주사위 굴리기" }),
  ).toBeEnabled();
  await expect(page.getByRole("alert")).toHaveCount(0);
});
test("토너먼트의 DP 점수·통계·리플레이 연결", async ({ page }) => {
  await page.goto("#tournament");
  await page.getByLabel("DP Expert", { exact: true }).check();
  await page.getByLabel("조합별 경기 수").fill("1");
  await page.getByRole("button", { name: "토너먼트 시작" }).click();
  await expect(page.locator(".progress-row")).toContainText("100%");
  await expect(page.locator(".stats-table")).toContainText("DP Expert");
  await expect(page.locator(".match-list>div")).toHaveCount(3);
});
test("테이블 로딩 실패 후 분석 재시도 가능", async ({ page }) => {
  await page.route("**/dp-values-*.gz", (route) => route.abort());
  await page.goto("#analysis");
  await selectDP(page);
  await page.getByRole("button", { name: "전략 비교하기" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.unroute("**/dp-values-*.gz");
  await page.getByRole("button", { name: "전략 비교하기" }).click();
  await expect(page.locator(".analysis-answer")).toContainText(
    "전체 게임 기대 최종점수",
  );
});

test("사람 대전은 두 턴에 DP 테이블을 한 번만 로드", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  await page.goto("#play");
  await page.getByLabel("상대 AI").selectOption("DP Expert");
  for (let turn = 0; turn < 2; turn++) {
    await page.getByRole("button", { name: "주사위 굴리기" }).click();
    await page.locator(".score-option").first().click();
    await expect(
      page.getByRole("button", { name: "주사위 굴리기" }),
    ).toBeEnabled({ timeout: 15000 });
  }
  expect(requests.filter((u) => u.includes("dp-values-"))).toHaveLength(1);
});

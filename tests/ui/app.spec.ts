import { chooseAlgorithm } from "./helpers";
import { test, expect, type Page } from "@playwright/test";
async function navigate(page: Page, name: string) {
  if (
    (await page
      .getByRole("button", { name: "메뉴 열기/닫기" })
      .getAttribute("aria-expanded")) === "false"
  )
    await page.getByRole("button", { name: "메뉴 열기/닫기" }).click();
  await page.getByRole("link", { name, exact: true }).click();
}
test("홈 문구와 장식 주사위, 메뉴와 새로고침", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("");
  await expect(page.locator("main h1")).toHaveText(
    "요트다이스를 플레이해보세요",
  );
  await expect(page.locator(".hero-intro .die-icon")).toHaveCount(3);
  await expect(page.locator(".demo-dice .die-icon")).toHaveCount(5);
  await expect(page.locator("header a, header .brand")).toHaveCount(0);
  await expect(page.locator(".home-shortcuts a")).toHaveCount(2);
  await navigate(page, "전략 분석실");
  await expect(
    page.getByRole("heading", { name: "전략 분석실" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "전략 분석실" }),
  ).toBeVisible();
  await navigate(page, "홈");
  await expect(page.locator(".hero")).toBeVisible();
  expect(errors).toEqual([]);
  await page.screenshot({
    path: `test-results/home-${test.info().project.name}.png`,
    fullPage: true,
  });
});
test("굴림, 고정, 재굴림 한도, 점수 선택과 AI 턴", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("#play");
  await page.getByRole("button", { name: "주사위 굴리기" }).click();
  const first = page.locator(".die-button").first();
  const before = await first.getAttribute("aria-label");
  await first.click();
  await expect(first).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "다시 굴리기" }).click();
  await expect(first).toHaveAttribute(
    "aria-label",
    before!.replace("고정 안 됨", "고정됨"),
  );
  await page.getByRole("button", { name: "다시 굴리기" }).click();
  await expect(
    page.getByRole("button", { name: "다시 굴리기" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: /에이스.*점 선택/ }).click();
  await expect(page.getByRole("button", { name: "주사위 굴리기" })).toBeEnabled(
    { timeout: 15000 },
  );
  await expect(page.locator(".scoreboard .fixed-score")).toHaveCount(2);
  expect(errors).toEqual([]);
  await page.screenshot({
    path: `test-results/play-${test.info().project.name}.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "재대결", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "주사위 굴리기" }),
  ).toBeEnabled();
});
test("키보드 정렬은 눈과 고정 상태 보존", async ({ page }) => {
  await page.goto("#play");
  await page.getByRole("button", { name: "주사위 굴리기" }).click();
  const die = page.locator(".die-button").first();
  await die.click();
  const identity = await die.getAttribute("aria-label");
  await die.focus();
  await page.keyboard.press("Alt+ArrowRight");
  await expect(page.locator(".die-button").nth(1)).toHaveAttribute(
    "aria-label",
    identity!,
  );
});
test("포인터 드래그 정렬 및 클릭 충돌 방지", async ({ page }) => {
  await page.goto("#play");
  await page.getByRole("button", { name: "주사위 굴리기" }).click();
  const dice = page.locator(".die-button"),
    identity = await dice.first().getAttribute("aria-label"),
    a = await dice.first().boundingBox(),
    b = await dice.nth(2).boundingBox();
  await page.mouse.move(a!.x + a!.width / 2, a!.y + a!.height / 2);
  await page.mouse.down();
  await page.mouse.move(b!.x + b!.width / 2, b!.y + b!.height / 2, {
    steps: 15,
  });
  await page.mouse.up();
  await expect(dice.nth(2)).toHaveAttribute("aria-label", identity!);
});
test("관전, 속도, 이전 행동 및 즉시 완료", async ({ page }) => {
  await page.goto("#watch");
  await page.getByRole("button", { name: "새 경기 시작" }).click();
  await expect(page.getByRole("button", { name: "일시정지" })).toBeEnabled({
    timeout: 20000,
  });
  await page.getByRole("button", { name: "일시정지" }).click();
  await page.getByRole("button", { name: "처음부터", exact: true }).click();
  await page.getByRole("button", { name: "다음 행동" }).click();
  const first = await page.locator(".dice-row").innerHTML();
  await page.getByRole("button", { name: "다음 행동" }).click();
  await page.getByRole("button", { name: "이전 행동" }).click();
  expect(await page.locator(".dice-row").innerHTML()).toBe(first);
  await page.getByLabel("재생 속도").selectOption("instant");
  await page.getByRole("button", { name: "재생", exact: true }).click();
  await expect(page.locator(".action-caption")).toContainText(/승리|무승부/);
  await expect(page.locator(".scoreboard .fixed-score")).toHaveCount(24);
});
test("토너먼트 실제 통계와 리플레이", async ({ page }) => {
  await page.goto("#tournament");
  await page.getByLabel("조합별 경기 수").fill("2");
  await page.getByRole("button", { name: "토너먼트 시작" }).click();
  await expect(page.locator(".progress-row")).toContainText("100%");
  await expect(page.locator(".match-list>div")).toHaveCount(2);
  await expect(page.locator(".stats-table tbody tr")).toHaveCount(2);
  await page
    .getByRole("button", { name: "리플레이", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "AI 대전 관전" }),
  ).toBeVisible();
  await expect(page.getByLabel("리플레이 위치")).toBeEnabled();
});
test("분석은 실제 상태와 알고리즘별 결과 출력", async ({ page }) => {
  await page.goto("#analysis");
  await page.getByLabel("분석 주사위 1").selectOption("6");
  await page.getByRole("button", { name: "전략 비교하기" }).click();
  await expect(page.locator(".analysis-answer")).toHaveCount(2, {
    timeout: 20000,
  });
  await expect(page.locator(".analysis-answer").last()).toContainText(
    "근사 효용",
  );
  await page.screenshot({
    path: `test-results/analysis-${test.info().project.name}.png`,
    fullPage: true,
  });
});
test("모바일 터치 드래그와 가로 넘침", async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "터치 기기 전용");
  await page.goto("#play");
  await page.getByRole("button", { name: "주사위 굴리기" }).tap();
  const dice = page.locator(".die-button"),
    id = await dice.first().getAttribute("aria-label"),
    a = await dice.first().boundingBox(),
    b = await dice.nth(2).boundingBox();
  const cdp = await context.newCDPSession(page);
  const y = a!.y + a!.height / 2,
    x = a!.x + a!.width / 2,
    target = b!.x + b!.width / 2;
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y }],
  });
  for (let i = 1; i <= 12; i++) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: x + ((target - x) * i) / 12, y }],
    });
    await page.waitForTimeout(20);
  }
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect(dice.nth(2)).toHaveAttribute("aria-label", id!);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("PPO와 12라운드 완주, 최종 승패와 재대결", async ({ page }) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("#play");
  await chooseAlgorithm(page, "\uc0c1\ub300 AI", "PPO");
  for (let round = 0; round < 12; round++) {
    await expect(
      page.getByRole("button", { name: "주사위 굴리기" }),
    ).toBeEnabled({ timeout: 15000 });
    await page.getByRole("button", { name: "주사위 굴리기" }).click();
    await page.locator(".score-option").first().click();
  }
  await expect(page.locator(".game-result")).toBeVisible({ timeout: 15000 });
  await expect(page.locator(".scoreboard .fixed-score")).toHaveCount(24);
  expect(errors).toEqual([]);
  await page.getByRole("button", { name: "한 번 더 플레이" }).click();
  await expect(page.locator(".scoreboard .fixed-score")).toHaveCount(0);
});

test("토너먼트 중단 후 새 실험 가능", async ({ page }) => {
  await page.goto("#tournament");
  await page.getByLabel("MCTS", { exact: true }).check();
  await page.getByLabel("조합별 경기 수").fill("500");
  await page.getByRole("button", { name: "토너먼트 시작" }).click();
  await page.getByRole("button", { name: "중단", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("취소");
  await expect(
    page.getByRole("button", { name: "토너먼트 시작" }),
  ).toBeEnabled();
});

test("PPO 분석은 실제 정책 확률 표시", async ({ page }) => {
  await page.goto("#analysis");
  await page.getByLabel("Greedy", { exact: true }).uncheck();
  await page.getByLabel("Expectimax", { exact: true }).uncheck();
  await page.getByLabel("PPO", { exact: true }).check();
  await page.getByRole("button", { name: "전략 비교하기" }).click();
  await expect(page.locator(".analysis-answer")).toContainText("정책 확률");
  await expect(page.locator(".analysis-answer .value-label")).toContainText(
    "%",
  );
});

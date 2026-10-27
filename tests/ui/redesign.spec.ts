import { test, expect } from "@playwright/test";
test("홈 시연은 굴림·고정·재굴림·점수 기록 후 다음 턴으로 반복", async ({
  page,
}) => {
  const errors: string[] = [],
    requests: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => requests.push(r.url()));
  await page.clock.install();
  await page.goto("");
  const demo = page.locator(".home-demo");
  await expect(demo).toHaveAttribute("data-phase", "ready");
  await page.clock.runFor(750);
  await expect(demo).toHaveAttribute("data-phase", "rolling");
  await page.clock.runFor(400);
  await expect(demo).toHaveAttribute("data-phase", "roll");
  await page.clock.runFor(1200);
  await expect(demo).toHaveAttribute("data-phase", "hold");
  const held = await page
    .locator(".demo-die[data-held=true]")
    .evaluateAll((nodes) =>
      nodes.map((n) => ({
        id: n.getAttribute("data-id"),
        value: n.getAttribute("data-value"),
      })),
    );
  expect(held.length).toBeGreaterThan(0);
  await page.clock.runFor(1500);
  for (const die of held)
    await expect(
      page.locator(`.demo-die[data-id="${die.id}"]`),
    ).toHaveAttribute("data-value", die.value!);
  await page.clock.runFor(4200);
  await expect(demo).toHaveAttribute("data-phase", "score");
  await expect(page.locator(".receipt-entry strong")).toHaveText("27");
  await page.screenshot({
    path: `test-results/home-turn-${test.info().project.name}.png`,
    fullPage: true,
    animations: "disabled",
  });
  await page.clock.runFor(2400);
  await expect(demo).toHaveAttribute("data-clip", "1");
  // The six clips return to the first without creating any AI worker requests.
  const seen = new Set<string>(["0"]);
  let returned = false;
  for (let i = 0; i < 100; i++) {
    const clip = (await demo.getAttribute("data-clip"))!;
    seen.add(clip);
    if (seen.size === 6 && clip === "0") {
      returned = true;
      break;
    }
    await page.clock.runFor(1200);
  }
  expect(seen.size).toBe(6);
  expect(returned).toBe(true);
  expect(requests.some((url) => /\/worker[-.]/.test(url))).toBe(false);
  expect(errors).toEqual([]);
});
test("백그라운드 중 정지, 화면 이동 후 정리 및 홈 복귀", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.clock.install();
  await page.goto("");
  await page.clock.runFor(1200);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      value: true,
      configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.locator(".home-demo")).toHaveAttribute(
    "data-paused",
    "true",
  );
  const before = await page.locator(".home-demo").getAttribute("data-frame");
  await page.clock.runFor(30000);
  await expect(page.locator(".home-demo")).toHaveAttribute(
    "data-frame",
    before!,
  );
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      value: false,
      configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.clock.runFor(2000);
  expect(await page.locator(".home-demo").getAttribute("data-frame")).not.toBe(
    before,
  );
  await page.evaluate(() => {
    location.hash = "analysis";
  });
  await expect(page.locator(".home-demo")).toHaveCount(0);
  await page.clock.runFor(20000);
  await page.evaluate(() => {
    location.hash = "home";
  });
  await expect(page.locator(".home-demo")).toHaveAttribute("data-frame", "0");
  await page.clock.runFor(1200);
  await expect(page.locator(".home-demo")).toHaveAttribute(
    "data-phase",
    "roll",
  );
  expect(errors).toEqual([]);
});
test("모션 감소 설정에서는 실제 완성된 턴을 정적으로 표시", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.install();
  await page.goto("");
  await expect(page.locator(".home-demo")).toHaveAttribute(
    "data-phase",
    "score",
  );
  await expect(page.locator(".home-demo")).toHaveAttribute(
    "data-paused",
    "true",
  );
  const before = await page.locator(".home-demo").innerHTML();
  await page.clock.runFor(60000);
  expect(await page.locator(".home-demo").innerHTML()).toBe(before);
  expect(
    await page
      .locator(".demo-die")
      .first()
      .evaluate((n) => getComputedStyle(n).animationName),
  ).toBe("none");
});
test("점수판 아이콘은 실제 눈 조합이고 작은 화면에서도 겹치지 않음", async ({
  page,
}) => {
  await page.goto("#play");
  const combinations: Record<string, number[]> = {
    aces: [1],
    deuces: [2],
    threes: [3],
    fours: [4],
    fives: [5],
    sixes: [6],
    four: [4, 4, 4, 4],
    full: [2, 2, 3, 3, 3],
    small: [1, 2, 3, 4],
    large: [1, 2, 3, 4, 5],
    yacht: [6, 6, 6, 6, 6],
  };
  for (const [category, values] of Object.entries(combinations)) {
    const row = page.locator(`[data-category="${category}"]`),
      icons = row.locator(".category-icon .die-icon");
    expect(
      await icons.evaluateAll((nodes) =>
        nodes.map((n) =>
          Number(n.getAttribute("aria-label")!.split(" ").at(-1)),
        ),
      ),
    ).toEqual(values);
    const label = await row.locator(".category-label").boundingBox(),
      cell = await row.locator("td").first().boundingBox();
    expect(label!.x + label!.width).toBeLessThanOrEqual(cell!.x + 1);
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `test-results/scoreboard-${test.info().project.name}.png`,
    fullPage: true,
  });
});
test("모든 메뉴의 흰 배경과 무채색·레드 팔레트, 차트 구분", async ({
  page,
}) => {
  for (const route of ["home", "play", "watch", "tournament", "analysis"]) {
    await page.goto(`#${route}`);
    expect(
      await page
        .locator("body")
        .evaluate((n) => getComputedStyle(n).backgroundColor),
    ).toBe("rgb(255, 255, 255)");
    await expect(page.locator("header a")).toHaveCount(0);
    const green = await page.locator("body *").evaluateAll((nodes) =>
      nodes.flatMap((n) => {
        const s = getComputedStyle(n);
        return [s.backgroundColor, s.color, s.borderTopColor].filter((v) => {
          const a = v.match(/[\d.]+/g)?.map(Number);
          return (
            a &&
            a[1] > a[0] + 8 &&
            a[1] > a[2] + 8 &&
            (a.length < 4 || a[3] > 0)
          );
        });
      }),
    );
    expect(green).toEqual([]);
  }
  await page.goto("#tournament");
  for (const algorithm of ["Expectimax", "MCTS", "PPO"])
    await page.getByLabel(algorithm, { exact: true }).check();
  await page.getByLabel("조합별 경기 수").fill("1");
  await page.getByRole("button", { name: "토너먼트 시작" }).click();
  await expect(page.locator(".progress-row")).toContainText("100%");
  const colors = await page
    .locator(".chart-row i")
    .evaluateAll((nodes) =>
      nodes.map((n) => getComputedStyle(n).backgroundColor),
    );
  expect(new Set(colors).size).toBe(colors.length);
  expect(colors).toHaveLength(5);
});

test("320px 화면에서도 홈·점수판·분석실이 잘리지 않음", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  for (const route of ["home", "play", "analysis", "watch"]) {
    await page.goto(`#${route}`);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.goto("#play");
  const row = page.locator('[data-category="large"]');
  const label = await row.locator(".category-label").boundingBox(),
    cell = await row.locator("td").first().boundingBox();
  expect(label!.x + label!.width).toBeLessThanOrEqual(cell!.x + 1);
});

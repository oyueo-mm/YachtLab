import { expect, test } from "@playwright/test";
import { scoreCategory, withMotion } from "./helpers";

test.describe("최초 방문", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("강조된 조작만 허용하고 고정 시나리오를 기록한다", async ({ page }) => {
    await page.goto("");
    const guide = page.getByRole("region", { name: "튜토리얼" });
    await expect(guide).toBeVisible();
    const dice = guide.locator(".die-button");
    const roll = guide.locator(".roll-button");
    await roll.click();
    await expect(dice.nth(2)).toBeDisabled();
    await expect(roll).toBeDisabled();
    await dice.nth(0).click();
    await expect(dice.nth(0)).toBeDisabled();
    await dice.nth(1).click();
    await dice.nth(1).click();
    await expect(dice.nth(1)).toHaveAttribute("aria-pressed", "false");
    await dice.nth(1).click();
    await roll.click();
    await expect(guide.locator('[data-die-id="2"] .die-button')).toBeEnabled();
    await guide.locator('[data-die-id="2"] .die-button').click();
    await roll.click();
    await expect(roll).toBeDisabled();
    await guide.getByRole("button", { name: /헥사.*24점 기록/ }).click();
    await expect(guide.getByText("헥사 24점 기록 완료")).toBeVisible();
    await guide.getByText("상단 6칸 · 63점 보너스").click();
    await expect(guide.getByText("63점 · 보너스 +35점")).toBeVisible();
    await guide.getByText("하단 6칸 · 초이스부터 요트까지").click();
    await expect(guide.locator(".tutorial-rules li")).toHaveCount(12);
    await expect(guide.locator(".tutorial-example-score").last()).toHaveText("50점");
    await guide.getByRole("button", { name: "홈으로 가기" }).click();
    await page.reload();
    await expect(guide).toHaveCount(0);
    await expect(page.getByRole("button", { name: "튜토리얼 다시 보기" })).toHaveCount(0);
    await page.goto("#tutorial");
    await expect(guide).toHaveCount(0);
    await page.goto("#offline");
    await page.getByRole("button", { name: "한 차례 연습하기" }).click();
    await expect(page.getByRole("region", { name: "한 차례 연습하기" })).toBeVisible();
    await expect(guide).toHaveCount(0);
  });

  test("초대 URL을 유지하고 건너뛴 뒤 다시 열지 않는다", async ({ page }) => {
    await page.goto("?room=ABCDEF#online");
    await page.getByRole("button", { name: "건너뛰기" }).click();
    await expect(page).toHaveURL(/room=ABCDEF#online$/);
    await page.reload();
    await expect(page.getByRole("region", { name: "튜토리얼" })).toHaveCount(0);
  });

  test("중도 새로고침과 레거시 방문은 자동 재실행하지 않는다", async ({ page }) => {
    await page.goto("");
    await expect(page.getByRole("region", { name: "튜토리얼" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("region", { name: "튜토리얼" })).toHaveCount(0);
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem("yachtlab.online.name", "기존사용자");
    });
    await page.reload();
    await expect(page.getByRole("region", { name: "튜토리얼" })).toHaveCount(0);
  });
});

test("첫 실제 경기의 안내와 기록 버튼은 점수를 기록하면 사라지고 기록된 점수가 남는다", async ({ page }) => {
  await page.goto("#play");
  await expect(page.getByText("주사위 굴리기를 눌러 시작하세요.")).toBeVisible();
  await page.getByRole("button", { name: "주사위 굴리기" }).click();
  await expect(page.getByText(/주사위를 눌러 킵할 수 있어요/)).toBeVisible();
  await scoreCategory(page, "choice");
  await expect(page.getByText(/주사위를 눌러 킵할 수 있어요/)).toHaveCount(0);
  await expect(page.locator(".game-feedback")).toContainText("초이스");
  if ((page.viewportSize()?.width ?? 1024) <= 760) {
    await page.getByRole("button", { name: "점수판 열기" }).click();
    const dialog = page.getByRole("dialog", { name: "점수판" });
    await dialog.getByRole("button", { name: "나", exact: true }).click();
    const recorded = dialog.locator('[data-category="choice"]');
    await expect(recorded.locator(".fixed-score")).toHaveText(/^\d+점$/);
    await expect(recorded.locator(".score-recorded-label")).toHaveText("기록됨");
    await expect(dialog.locator('[data-category="choice"] .score-option')).toHaveCount(0);
  } else {
    await expect(page.locator('.scoreboard [data-category="choice"] [aria-label$="점 기록됨"]').first()).toBeVisible();
    await expect(page.locator('.scoreboard [data-category="choice"] .score-option')).toHaveCount(0);
  }
});

test("휴대폰 점수표는 기본 한 열과 터치 영역을 유지하는 두 열을 비교할 수 있다", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1024) > 760, "모바일 점수 시트 비교");
  await page.goto("#play");
  await page.getByRole("button", { name: "주사위 굴리기" }).click();
  await page.getByRole("button", { name: "점수판 열기" }).click();
  const dialog = page.getByRole("dialog", { name: "점수판" });
  const groups = dialog.locator(".mobile-quick-groups");
  const listHeight = (await groups.boundingBox())!.height;
  const compact = dialog.getByRole("button", { name: "두 열 보기" });
  await expect(compact).toHaveAttribute("aria-pressed", "false");
  await compact.click();
  await expect(compact).toHaveAttribute("aria-pressed", "true");
  expect((await groups.boundingBox())!.height).toBeLessThan(listHeight * 0.7);
  const row = dialog.locator('[data-category="large"] .mobile-quick-row-live');
  expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await expect(dialog.getByRole("button", { name: "라지 스트레이트 설명" })).toBeVisible();
  await expect(row.getByText("라지 스트레이트", { exact: true })).toBeVisible();
  expect(await dialog.locator(".mobile-score-scroll").evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  await dialog.locator('[data-category="choice"] .score-option').click();
  await expect(dialog).toHaveCount(0);
});

test("한 차례 연습과 튜토리얼은 3D 테이블의 충돌·착지·킵과 해제를 사용한다", async ({ page }) => {
  await withMotion(page, "3d");
  await page.setViewportSize({ width: 320, height: 690 });
  await page.goto("#practice");
  const guide = page.getByRole("region", { name: "한 차례 연습하기" });
  const tray = guide.locator(".physical-dice");
  const shelf = tray.locator(".dice-hold-area");
  await expect(shelf).toHaveAttribute("aria-hidden", "true");
  await expect(shelf).not.toHaveAttribute("aria-label", /.+/);
  await expect(tray.locator("canvas")).toBeVisible();
  const roll = guide.getByRole("button", { name: "주사위 굴리기" });
  await roll.click();
  const dice = tray.locator(".die-hit");
  await expect(dice.nth(0)).toBeEnabled();
  await expect(dice.nth(2)).toBeDisabled();
  const status = await page.evaluate(() => {
    const w = window as unknown as { __yachtlabDice: { last: { mode: string; finals: unknown } }; __yachtlabSound: { log: { name: string }[] } };
    return { roll: w.__yachtlabDice.last, sounds: w.__yachtlabSound.log.map(({ name }) => name) };
  });
  expect(status.roll.mode).toBe("3d");
  expect(Object.values(status.roll.finals as Record<string, number>)).toEqual([6, 6, 3, 2, 1]);
  expect(status.sounds.indexOf("impact")).toBeGreaterThan(status.sounds.indexOf("throw"));
  expect(status.sounds.indexOf("settle")).toBeGreaterThan(status.sounds.indexOf("impact"));
  const trayBox = (await tray.boundingBox())!;
  for (const die of await dice.all()) {
    const box = (await die.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(trayBox.x - 1);
    expect(box.x + box.width).toBeLessThanOrEqual(trayBox.x + trayBox.width + 1);
  }
  await dice.nth(0).click();
  await expect(dice.nth(0)).toHaveAttribute("data-zone", "hold");
  await expect(tray.getByRole("button", { name: "주사위 1, 6, 고정됨", exact: true })).toHaveAttribute("aria-pressed", "true");
  await dice.nth(1).click();
  await expect(dice.nth(1)).toHaveAttribute("data-zone", "hold");
  await dice.nth(1).click();
  await expect(dice.nth(1)).toHaveAttribute("data-zone", "tray");
});

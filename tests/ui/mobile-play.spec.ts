import { expect, test } from "@playwright/test";
import { startAI, startLocal } from "./helpers";

test("모바일 AI: 점수 요약(위) → 주사위판 → 점수 기록 → 보조 메뉴 순서", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await startAI(page, { first: "내가 먼저" });
  const bounds = await page.evaluate(() => {
    const box = (selector: string) => {
      const element = document.querySelector(selector);
      if (!element) throw new Error("Missing layout element: " + selector);
      const rect = element.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom };
    };
    return { board: box(".page-play .game-board"), score: box(".page-play .mobile-score-button"), summary: box(".page-play .score-summary"), tools: box(".page-play .game-tools"), roll: box(".page-play .roll-button") };
  });
  expect(bounds.summary.bottom).toBeLessThanOrEqual(bounds.board.top);
  expect(bounds.board.top).toBeLessThan(bounds.score.top);
  expect(bounds.roll.bottom).toBeLessThanOrEqual(bounds.score.top);
  expect(bounds.score.bottom).toBeLessThanOrEqual(bounds.tools.top);
  await expect(page.locator(".page-play .board-top")).toBeHidden();
  await expect(page.getByRole("button", { name: "주사위 굴리기" })).toBeVisible();
  await expect(page.locator(".page-play .bonus-chip")).toContainText("보너스까지 63");
});

for (const size of [
  { width: 320, height: 568 },
  { width: 360, height: 640 },
  { width: 375, height: 667 },
  { width: 430, height: 932 },
])
  test(`휴대폰 ${size.width}×${size.height}: 점수·굴리기·추천 점수·점수 기록이 스크롤 없이 한 화면에, 굴린 뒤에도 버튼 위치 고정`, async ({ page }) => {
    await page.setViewportSize(size);
    await startAI(page, { first: "내가 먼저" });
    const place = () =>
      page.evaluate(() => {
        const r = (s: string) => document.querySelector(s)!.getBoundingClientRect();
        return { summary: r(".page-play .score-summary").top, roll: r(".page-play .roll-button").bottom, record: r(".page-play .mobile-score-button").bottom, vh: innerHeight };
      });
    const before = await place();
    expect(before.summary).toBeGreaterThanOrEqual(0);
    expect(before.record).toBeLessThanOrEqual(before.vh + 1);
    await page.getByRole("button", { name: "주사위 굴리기" }).click();
    await expect(page.getByRole("group", { name: "추천 점수 바로 기록" })).toBeVisible();
    const after = await place();
    // The quick-pick row was reserved: nothing below it moved when the picks appeared.
    expect(Math.abs(after.record - before.record)).toBeLessThanOrEqual(1);
  });

test("데스크톱 AI 대전: 도구 줄 바로 아래 보드, 점수·라운드·차례는 오른쪽 점수판 (2026-11-25 PC 배치)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await startAI(page, { first: "내가 먼저" });
  await expect(page.locator(".page-play .board-top")).toBeVisible();
  await expect(page.locator(".page-play .score-summary")).toBeHidden();
  const positions = await page.evaluate(() => {
    const top = (selector: string) => document.querySelector(selector)!.getBoundingClientRect().top;
    return { tools: top(".page-play .game-tools"), board: top(".page-play .game-board") };
  });
  expect(positions.tools).toBeLessThan(positions.board);
  await expect(page.locator(".page-play .scoreboard .score-round")).toContainText("/ 12 라운드");
  await expect(page.locator(".page-play .scoreboard thead th.current")).toHaveCount(1);
});

test("모바일 로컬 다인전은 차례·굴림 정보를 그대로 표시", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await startLocal(page, { count: 2 });
  await expect(page.locator(".page-pvp .board-top")).toBeVisible();
});

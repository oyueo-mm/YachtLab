import { expect, test } from "@playwright/test";
import { startAI, startLocal } from "./helpers";

test("모바일 AI: 주사위판 → 점수 기록 → 점수 요약 → 보조 메뉴 순서", async ({ page }) => {
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
  expect(bounds.board.top).toBeLessThan(bounds.score.top);
  expect(bounds.roll.bottom).toBeLessThanOrEqual(bounds.score.top);
  expect(bounds.score.bottom).toBeLessThanOrEqual(bounds.summary.top);
  expect(bounds.summary.bottom).toBeLessThanOrEqual(bounds.tools.top);
  await expect(page.locator(".page-play .board-top")).toBeHidden();
  await expect(page.getByRole("button", { name: "주사위 굴리기" })).toBeVisible();
});

test("데스크톱 AI 대전은 기존 정보·배치 유지", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await startAI(page, { first: "내가 먼저" });
  await expect(page.locator(".page-play .board-top")).toBeVisible();
  const positions = await page.evaluate(() => {
    const top = (selector: string) => document.querySelector(selector)!.getBoundingClientRect().top;
    return { tools: top(".page-play .game-tools"), summary: top(".page-play .score-summary"), board: top(".page-play .game-board") };
  });
  expect(positions.tools).toBeLessThan(positions.summary);
  expect(positions.summary).toBeLessThan(positions.board);
});

test("모바일 로컬 다인전은 차례·굴림 정보를 그대로 표시", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await startLocal(page, { count: 2 });
  await expect(page.locator(".page-pvp .board-top")).toBeVisible();
});

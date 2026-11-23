import {scoreCategory, startLocal} from "./helpers";
import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("로컬 PvP: 이름, 양쪽 점수 선택, 재대결 및 기보", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await startLocal(page, { count: 2, names: ["민수", "지민"] });
  await expect(page.locator(".turn-indicator")).toContainText("민수의 차례");
  await page.getByRole("button", { name: "주사위 굴리기" }).click();
  await scoreCategory(page,"aces");
  await expect(page.locator(".turn-indicator")).toContainText("지민의 차례");
  await expect(page.getByLabel("플레이어 1 이름")).toHaveCount(0);
  await expect(page.locator('[data-category="aces"] td').first().locator(".fixed-score")).toHaveCount(1);
  await page.getByRole("button", { name: "주사위 굴리기" }).click();
  await expect(page.locator('[data-category="deuces"] td').nth(0).locator(".score-option")).toHaveCount(0);
  await expect(page.locator('[data-category="deuces"] td').nth(1).locator(".score-option")).toHaveCount(1);
  await scoreCategory(page,"deuces");
  await expect(page.locator(".turn-indicator")).toContainText("민수의 차례");
  await expect(page.locator(".scoreboard .fixed-score")).toHaveCount(2);

  await page.getByRole("button", { name: "기보 보기" }).click();
  await expect(page.getByRole("dialog", { name: "기보 보기" })).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "JSON 내보내기", exact: true }).click();
  const file = await download;
  const record = JSON.parse(await readFile((await file.path())!, "utf8"));
  expect(record.metadata.players).toEqual([
    { type: "human", name: "민수" },
    { type: "human", name: "지민" },
  ]);
  expect(record.format).toBe("YachtLabMultiReplay");
  expect(record.actions).toHaveLength(4);
  expect(record.finalState.player).toBe(0);
  await page.getByRole("button", { name: "기보 닫기" }).click();
  await page.getByRole("button", { name: "재대결", exact: true }).click();
  await page.getByRole("dialog", { name: "새 경기를 시작할까요?" }).getByRole("button", { name: "재대결" }).click();
  await expect(page.locator(".scoreboard .fixed-score")).toHaveCount(0);
  await expect(page.locator(".multi-player-chip span")).toHaveText(["민수", "지민"]);
  expect(errors).toEqual([]);
});

test("로컬 PvP: 24턴 완주, 승패 표시, 두 점수판 확정", async ({ page }) => {
  await page.goto("#pvp");
  for (let turn = 0; turn < 24; turn++) {
    await expect(page.locator(".turn-indicator")).toContainText(`플레이어 ${(turn % 2) + 1}의 차례`);
    await page.getByRole("button", { name: "주사위 굴리기" }).click();
    await scoreCategory(page);
  }
  await expect(page.locator(".game-result")).toContainText(/승리|무승부|공동 우승/);
  await expect(page.locator(".scoreboard .fixed-score")).toHaveCount(24);
  await expect(page.locator(".game-board .roll-button")).toBeDisabled();
  await page.getByRole("button", { name: "한 번 더 플레이" }).click();
  await expect(page.locator(".scoreboard .fixed-score")).toHaveCount(0);
});

test("로컬 PvP: 모바일에서도 점수판과 주사위를 가로 스크롤 없이 조작", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "모바일 전용");
  await page.goto("#pvp");
  await page.getByRole("button", { name: "주사위 굴리기" }).tap();
  await scoreCategory(page);
  await page.getByRole("button", { name: "주사위 굴리기" }).tap();
  await scoreCategory(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

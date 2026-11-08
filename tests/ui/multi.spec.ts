import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("3인전: 인원 변경, 이름, 턴 교대와 라운드", async ({ page }) => {
  await page.goto("#pvp");
  await page.getByLabel("참가 인원", { exact: true }).fill("3");
  await page.getByLabel("플레이어 3 이름").fill("삼");
  await expect(page.locator(".multi-player-chip")).toHaveCount(3);
  for (let i = 0; i < 3; i++) {
    await expect(page.locator(".turn-indicator")).toContainText(i === 2 ? "삼의 차례" : "플레이어 " + (i + 1) + "의 차례");
    await page.getByRole("button", { name: "주사위 굴리기" }).click();
    await page.locator(".score-option").first().click();
  }
  await expect(page.locator(".board-top")).toContainText("라운드 2/12");
  await expect(page.locator(".scoreboard .fixed-score")).toHaveCount(3);
  await expect(page.getByLabel("참가 인원", { exact: true })).toBeDisabled();
});

test("UI 간소화와 턴 전환 시 이전 주사위 눈 숨김", async ({ page }) => {
  await page.goto("#pvp");
  await page.getByLabel("참가 인원", { exact: true }).fill("4");
  await expect(page.locator(".multi-toolbar")).toBeVisible();
  await expect(page.locator(".multi-config")).toHaveCount(0);
  await expect(page.locator(".multi-local-game .multi-player-chip")).toHaveCount(4);
  await expect(page.locator(".multi-toolbar-names")).toHaveCount(0);
  await page.getByRole("button", { name: "플레이어 설정" }).click();
  await expect(page.getByLabel("플레이어 4 이름")).toBeVisible();
  await page.getByRole("button", { name: "플레이어 설정" }).click();
  await expect(page.locator(".multi-dice-ready")).toBeVisible();
  await expect(page.locator(".multi-dice-ready .die-icon circle").first()).toHaveCSS("opacity", "0");
  await page.getByRole("button", { name: "주사위 굴리기" }).click();
  await expect(page.locator(".multi-dice-ready")).toHaveCount(0);
  await page.locator(".score-option").first().click();
  await expect(page.locator(".turn-indicator")).toContainText("플레이어 2의 차례");
  await expect(page.locator(".multi-dice-ready .die-icon circle").first()).toHaveCSS("opacity", "0");
  await page.getByRole("button", { name: "주사위 굴리기" }).click();
  await page.locator(".score-option").first().click();
  await page.getByRole("button", { name: "기보 보기" }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "JSON 내보내기", exact: true }).click();
  const file = await download;
  const saved = JSON.parse(await readFile((await file.path())!, "utf8"));
  expect(saved.version).toBe(2);
  expect(new Set(saved.finalState.rng).size).toBe(4);
  await page.getByRole("button", { name: "기보 닫기" }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("4인전: 48턴 완주, 공동 우승 가능 및 완성된 기보", async ({ page }) => {
  await page.goto("#pvp");
  await page.getByLabel("참가 인원", { exact: true }).fill("4");
  for (let i = 0; i < 48; i++) {
    await expect(page.locator(".turn-indicator")).toContainText("플레이어 " + (i % 4 + 1) + "의 차례");
    await page.getByRole("button", { name: "주사위 굴리기" }).click();
    await page.locator(".score-option").first().click();
  }
  await expect(page.locator(".game-result")).toContainText(/승리|공동 우승/);
  await expect(page.locator(".scoreboard .fixed-score")).toHaveCount(48);
  await expect(page.locator(".multi-standing-row")).toHaveCount(4);
  await page.getByRole("button", { name: "기보 보기" }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "JSON 내보내기", exact: true }).click();
  const file = await download;
  const record = JSON.parse(await readFile((await file.path())!, "utf8"));
  expect(record.actions).toHaveLength(96);
  expect(record.finalState.done).toBe(true);
  expect(record.finalState.cards).toHaveLength(4);
  await page.getByRole("button", { name: "기보 닫기" }).click();
  await page.getByRole("button", { name: "한 번 더 플레이" }).click();
  await expect(page.locator(".scoreboard .fixed-score")).toHaveCount(0);
  await expect(page.getByLabel("참가 인원", { exact: true })).toHaveValue("4");
});

test("9인전: 현재 점수판, 전체 순위, 가로 스크롤 점수표", async ({ page }) => {
  await page.goto("#pvp");
  await page.getByLabel("참가 인원", { exact: true }).fill("9");
  await expect(page.locator(".multi-standing-row")).toHaveCount(9);
  await expect(page.locator(".multi-scoreboard thead th")).toHaveCount(2);
  await page.getByRole("button", { name: "주사위 굴리기" }).click();
  await page.locator(".score-option").first().click();
  await expect(page.locator(".turn-indicator")).toContainText("플레이어 2의 차례");
  await page.getByRole("button", { name: "전체 점수표" }).click();
  await expect(page.locator(".multi-scoreboard thead th")).toHaveCount(10);
  await expect(page.locator(".multi-scoreboard .fixed-score")).toHaveCount(1);
  await page.getByRole("button", { name: "내 점수판" }).click();
  await expect(page.locator(".multi-scoreboard thead th")).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("50인전: 빠른 설정과 반응형 표시, 기보 저장·불러오기", async ({ page }) => {
  await page.goto("#pvp");
  await page.getByLabel("참가 인원", { exact: true }).fill("50");
  await expect(page.locator(".multi-player-chip")).toHaveCount(50);
  await expect(page.locator(".multi-standing-row")).toHaveCount(50);
  await page.getByRole("button", { name: "주사위 굴리기" }).click();
  await page.locator(".score-option").first().click();
  await expect(page.locator(".turn-indicator")).toContainText("플레이어 2의 차례");
  await page.getByRole("button", { name: "기보 보기" }).click();
  const dialog = page.getByRole("dialog", { name: "기보 보기" });
  await expect(dialog).toBeVisible();
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect(dialog.getByText("브라우저에 기보를 저장했습니다.")).toBeVisible();
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "JSON 내보내기", exact: true }).click();
  const file = await downloaded;
  const content = await readFile((await file.path())!, "utf8");
  const record = JSON.parse(content);
  expect(record.metadata.players).toHaveLength(50);
  expect(record.actions).toHaveLength(2);
  await page.getByLabel("기보 JSON 불러오기").setInputFiles({ name: "replay.json", mimeType: "application/json", buffer: Buffer.from(content) });
  await expect(dialog.getByText("기보를 불러왔습니다.")).toBeVisible();
  await page.getByRole("button", { name: "기보 닫기" }).click();
  await expect(page.locator(".turn-indicator")).toContainText("플레이어 2의 차례");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

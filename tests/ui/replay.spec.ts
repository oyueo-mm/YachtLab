import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { chooseAlgorithm } from "./helpers";
async function exported(page: Page) {
  const event = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "JSON 내보내기", exact: true })
    .click();
  const download = await event;
  return JSON.parse(await readFile((await download.path())!, "utf8"));
}
test("진행 중 기보 저장·JSON 검증·로컬 이름 변경·삭제와 원래 대국 복귀", async ({
  page,
}) => {
  await page.goto("#play");
  await page.getByRole("button", { name: "주사위 굴리기" }).click();
  const live = await page.locator(".dice-row").innerHTML();
  await page.getByRole("button", { name: "기보 보기", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "기보 보기" });
  await expect(dialog).toBeVisible();
  await page.getByLabel("기보 이름", { exact: true }).fill("보존 확인");
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect(
    dialog.getByText("브라우저에 기보를 저장했습니다.", { exact: true }),
  ).toBeVisible();
  const record = await exported(page);
  expect(record.version).toBe(1);
  expect(record.frames).toHaveLength(2);
  await page
    .getByLabel("기보 JSON 불러오기")
    .setInputFiles({
      name: "bad.json",
      mimeType: "application/json",
      buffer: Buffer.from('{"version":99}'),
    });
  await expect(page.getByRole("alert")).toBeVisible();
  expect((await exported(page)).frames).toEqual(record.frames);
  await page.getByRole("button", { name: "저장된 기보", exact: true }).click();
  await page
    .getByLabel("저장 이름 보존 확인", { exact: true })
    .fill("이름 변경");
  await page.getByRole("button", { name: "열기", exact: true }).focus();
  await expect(
    page.getByLabel("저장 이름 이름 변경", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "이름 변경 삭제", exact: true })
    .click();
  await expect(page.getByText("저장된 기보가 없습니다.")).toBeVisible();
  await page.getByRole("button", { name: "기보 닫기" }).click();
  const after = await page.locator(".dice-row").innerHTML();
  expect(after).toBe(live);
  await expect(page.getByRole("button", { name: "다시 굴리기" })).toBeEnabled();
});
test("v0.3 JSON 중간 고정 상태에서 분기하여 완주하고 원본과 난수 보존", async ({
  page,
}) => {
  const match = JSON.parse(
      readFileSync("tests/fixtures/match-782.json", "utf8"),
    ),
    idx = match.frames.findIndex((f: any) => f.action?.type === "hold");
  await page.goto("#watch");
  await page
    .getByRole("button", { name: "기보 보기 · 저장 · 불러오기" })
    .click();
  await page
    .getByLabel("기보 JSON 불러오기")
    .setInputFiles({
      name: "legacy.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(match)),
    });
  await page.getByLabel("기보 타임라인").fill(String(idx));
  const original = await exported(page);
  await page.getByRole("button", { name: "AI 아레나에서 이어하기" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await chooseAlgorithm(page, "AI 1", "Greedy");
  await chooseAlgorithm(page, "AI 2", "Random");
  await page
    .getByRole("button", { name: "이 상태부터 시작", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "이 상태부터 시작", exact: true }),
  ).toBeEnabled();
  await page.getByLabel("재생 속도", { exact: true }).selectOption("instant");
  await expect(page.locator(".action-caption")).toContainText(/승리|무승부/);
  await page
    .getByRole("button", { name: "기보 보기 · 저장 · 불러오기" })
    .click();
  const branch = await exported(page);
  expect(branch.finalState.done).toBe(true);
  expect(branch.metadata.source.frameIndex).toBe(idx);
  expect(branch.frames.slice(0, idx + 1)).toEqual(
    original.frames.slice(0, idx + 1),
  );
  expect(branch.frames[idx].state).toEqual(match.frames[idx].state);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(
    await page
      .getByRole("dialog")
      .evaluate((n) => n.scrollWidth <= n.clientWidth + 1),
  ).toBe(true);
  await page.screenshot({
    path: `test-results/replay-${test.info().project.name}.png`,
  });
});
test("AI 행동 중 기보를 열면 대국은 정지하고 닫으면 재개", async ({ page }) => {
  await page.goto("#play");
  await chooseAlgorithm(page, "상대 AI", "Random");
  await page.getByRole("button", { name: "주사위 굴리기" }).click();
  await page.locator(".score-option").first().click();
  await page.getByRole("button", { name: "기보 보기", exact: true }).click();
  const before = await exported(page);
  await page.waitForTimeout(1700);
  const after = await exported(page);
  expect(after.frames).toEqual(before.frames);
  await page.getByRole("button", { name: "기보 닫기" }).click();
  await expect(page.locator(".ai-action-status")).toContainText(
    /굴렸습니다|기록|고정/,
  );
  await expect(page.getByRole("alert")).toHaveCount(0);
});
test("기보의 실제 선택을 전략 분석실의 공통 DP 가치로 비교", async ({
  page,
}) => {
  const match = JSON.parse(
      readFileSync("tests/fixtures/match-79.json", "utf8"),
    ),
    idx = match.frames.findIndex((f: any) => f.action?.type === "score");
  await page.goto("#watch");
  await page
    .getByRole("button", { name: "기보 보기 · 저장 · 불러오기" })
    .click();
  await page
    .getByLabel("기보 JSON 불러오기")
    .setInputFiles({
      name: "match.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(match)),
    });
  await page.getByLabel("기보 타임라인").fill(String(idx));
  await page.getByRole("button", { name: "이 수를 분석하기" }).click();
  await expect(
    page.getByRole("heading", { name: "전략 분석실", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "전략 비교하기" }).click();
  await expect(
    page.getByRole("heading", { name: "공통 DP 기준 비교" }),
  ).toBeVisible({ timeout: 30000 });
  await expect(page.getByText(/기보의 실제 선택:/)).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

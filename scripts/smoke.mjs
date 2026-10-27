async function chooseAlgorithm(page, label, value) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name: value, exact: true }).click();
}
import { chromium, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

const url = process.argv[2];
if (!url?.startsWith("https://oyueo-mm.github.io/YachtLab/"))
  throw Error("Pass the YachtLab public URL.");
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const response = await page.goto(url, { waitUntil: "networkidle" });
  expect(response.status()).toBe(200);
  await expect(page.locator("main h1")).toHaveText(
    "요트다이스를 플레이해보세요",
  );
  await expect(page.locator(".hero-intro .die-icon")).toHaveCount(3);
  await expect(page.locator(".demo-dice .die-icon")).toHaveCount(5);
  await expect(page.locator("header a")).toHaveCount(0);
  await expect(page.locator(".home-shortcuts a")).toHaveCount(2);
  await expect(page.locator(".home-demo")).toHaveAttribute(
    "data-frame",
    /^[1-9]/,
    { timeout: 10000 },
  );
  await page.screenshot({
    path: "test-results/public-home.png",
    fullPage: true,
  });
  await page.getByRole("link", { name: "AI 대전 관전", exact: true }).click();
  await chooseAlgorithm(page, "AI 1", "DP Expert");
  await page.getByRole("button", { name: "새 경기 시작" }).click();
  await expect(page.getByRole("button", { name: "일시정지" })).toBeEnabled({
    timeout: 30000,
  });
  await page.getByLabel("재생 속도").selectOption("instant");
  await expect(page.locator(".action-caption")).toContainText(/승리|무승부/);
  await expect(page.locator(".scoreboard .fixed-score")).toHaveCount(24);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "AI 대전 관전" }),
  ).toBeVisible();
  await chooseAlgorithm(page, "AI 1", "Distilled Policy");
  await chooseAlgorithm(page, "AI 2", "Distilled PPO");
  await page.getByRole("button", { name: "새 경기 시작" }).click();
  await expect(
    page.getByRole("button", { name: "일시정지", exact: true }),
  ).toBeEnabled({ timeout: 30000 });
  await page.getByLabel("재생 속도").selectOption("instant");
  await expect(page.locator(".scoreboard .fixed-score")).toHaveCount(24);
  await page
    .getByRole("button", { name: "기보 보기 · 저장 · 불러오기" })
    .click();
  await page.getByLabel("기보 타임라인").fill("1");
  const downloadEvent = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "JSON 내보내기", exact: true })
    .click();
  const file = await downloadEvent,
    bytes = await readFile(await file.path());
  const record = JSON.parse(bytes.toString("utf8"));
  expect(record.version).toBe(1);
  await page
    .getByLabel("기보 JSON 불러오기")
    .setInputFiles({
      name: "roundtrip.json",
      mimeType: "application/json",
      buffer: bytes,
    });
  await page.getByLabel("기보 타임라인").fill("1");
  await page.getByRole("button", { name: "AI 아레나에서 이어하기" }).click();
  await page
    .getByRole("button", { name: "이 상태부터 시작", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "이 상태부터 시작", exact: true }),
  ).toBeEnabled({ timeout: 30000 });
  await page.getByLabel("재생 속도").selectOption("instant");
  await expect(page.locator(".scoreboard .fixed-score")).toHaveCount(24);
  const chart = await page.request.get(
    new URL("research/learning-curves.svg", url).href,
  );
  expect(chart.status()).toBe(200);
  expect(errors).toEqual([]);
  console.log(
    JSON.stringify({
      url,
      status: response.status(),
      home: true,
      workerMatch: true,
      dpExpert: true,
      hashRefresh: true,
      distilledModels: true,
      replayRoundTrip: true,
      arenaBranch: true,
      learningCurves: true,
      pageErrors: errors,
    }),
  );
} finally {
  await browser.close();
}

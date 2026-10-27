import { chromium, expect } from "@playwright/test";

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
  await page
    .getByRole("combobox", { name: "AI 1", exact: true })
    .selectOption("DP Expert");
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
  expect(errors).toEqual([]);
  console.log(
    JSON.stringify({
      url,
      status: response.status(),
      home: true,
      workerMatch: true,
      dpExpert: true,
      hashRefresh: true,
      pageErrors: errors,
    }),
  );
} finally {
  await browser.close();
}

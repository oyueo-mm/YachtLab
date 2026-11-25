import { expect, test } from "@playwright/test";

test("홈과 가이드는 자바스크립트 없이 열리고 사이트맵의 canonical 주소와 일치한다", async ({ browser, request, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL, viewport: { width: 360, height: 780 } });
  try {
    const page = await context.newPage();
    const home = await page.goto("./");
    expect(home?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "온라인 요트다이스" })).toBeVisible();
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://oyueo-mm.github.io/YachtLab/");
    await page.getByRole("link", { name: "규칙과 전략" }).click();
    await expect(page).toHaveURL(/\/YachtLab\/guide\/$/);
    await expect(page.getByRole("table").first().locator("tbody tr")).toHaveCount(12);
    await expect(page.getByRole("heading", { name: "첫 굴림에서 족보가 나올 확률" })).toBeVisible();
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://oyueo-mm.github.io/YachtLab/guide/");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(360);
    const sitemap = await request.get("./sitemap.xml");
    expect(sitemap.ok()).toBe(true);
    expect(await sitemap.text()).toContain("<loc>https://oyueo-mm.github.io/YachtLab/guide/</loc>");
  } finally {
    await context.close();
  }
});

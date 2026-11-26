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

const SEARCH_PAGES = ["faq/", "ai/", "multiplayer/", "strategy/", "scores/", "probability/"];

test("검색용 페이지는 자바스크립트 없이 열리고 canonical·사이트맵·게임 링크를 갖는다", async ({ browser, request, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL, viewport: { width: 360, height: 780 } });
  try {
    const page = await context.newPage();
    const sitemap = await (await request.get("./sitemap.xml")).text();
    const titles = new Set<string>();
    for (const path of SEARCH_PAGES) {
      const res = await page.goto("./" + path);
      expect(res?.status(), path).toBe(200);
      await expect(page.locator("h1")).toHaveCount(1);
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://oyueo-mm.github.io/YachtLab/" + path);
      titles.add(await page.title());
      expect(sitemap).toContain(`<loc>https://oyueo-mm.github.io/YachtLab/${path}</loc>`);
      await expect(page.locator('a[href="../#online"]').first()).toBeAttached();
      expect(await page.evaluate(() => document.documentElement.scrollWidth), path).toBeLessThanOrEqual(360);
    }
    expect(titles.size).toBe(SEARCH_PAGES.length);
  } finally {
    await context.close();
  }
});

test("초대·캠페인 파라미터가 있어도 홈 canonical은 기본 주소다", async ({ page }) => {
  await page.goto("./?room=ABC234&utm_source=kakao&utm_medium=share&utm_campaign=test#online");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://oyueo-mm.github.io/YachtLab/");
});

test("실제 주사위용 점수판: 보너스·합계·승자 자동 계산, 새로고침 후 유지", async ({ page }) => {
  await page.goto("./scores/");
  const fill = async (label: string, value: number) => page.getByLabel(label, { exact: true }).fill(String(value));
  for (const [cat, a, b] of [["에이스 (1)", 3, 1], ["듀스 (2)", 6, 4], ["트리플 (3)", 9, 6], ["쿼드 (4)", 12, 8], ["펜타 (5)", 15, 10], ["헥사 (6)", 18, 12]] as const) {
    await fill(`플레이어 1 ${cat}`, a);
    await fill(`플레이어 2 ${cat}`, b);
  }
  await expect(page.locator('[data-bonus="0"]')).toHaveText("+35 (63)");
  await expect(page.locator('[data-bonus="1"]')).toHaveText("41 / 63");
  for (const [cat, a, b] of [["초이스", 20, 22], ["포커", 0, 0], ["풀 하우스", 25, 0], ["스몰 스트레이트", 15, 15], ["라지 스트레이트", 30, 0], ["요트", 0, 50]] as const) {
    await fill(`플레이어 1 ${cat}`, a);
    await fill(`플레이어 2 ${cat}`, b);
  }
  await expect(page.locator('[data-total="0"]')).toHaveText(String(63 + 35 + 20 + 25 + 15 + 30));
  await expect(page.locator('[data-total="1"]')).toHaveText(String(41 + 22 + 15 + 50));
  await expect(page.locator("#pad-winner")).toContainText("승자: 플레이어 1");
  await page.reload();
  await expect(page.locator('[data-total="0"]')).toHaveText("188");
});

test("족보 확률 계산기: 2·3·4·5 킵, 재굴림 1번이면 라지 스트레이트 33.3%", async ({ page }) => {
  await page.goto("./probability/");
  const rows = page.locator("#odds tbody tr");
  await expect(rows).toHaveCount(12);
  await page.locator('input[name="rolls"][value="1"]').check();
  await expect(rows.filter({ hasText: "라지 스트레이트" }).locator("td").nth(1)).toContainText("33.3%");
  await expect(rows.filter({ hasText: "라지 스트레이트" }).locator("td").nth(3)).toHaveText("2·3·4·5");
});

test("UTM이 붙은 초대 링크도 방 입장 화면을 열고, 캠페인 값은 기기에 남기고 주소에서는 지운다", async ({ page }) => {
  await page.goto("./?room=ABC234&utm_source=kakao&utm_medium=invite&utm_campaign=test");
  await expect.poll(() => page.url()).not.toContain("utm_");
  expect(new URL(page.url()).searchParams.get("room")).toBe("ABC234");
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("yachtlab.attribution.v1") ?? "null"));
  expect(stored.first).toMatchObject({ source: "kakao", medium: "invite", campaign: "test" });
});

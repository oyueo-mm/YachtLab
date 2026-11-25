import { expect, test, type Page } from "@playwright/test";
import { scoreCategory, startAI } from "./helpers";

async function ready(page: Page) {
  await page.goto("");
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
}

test("설치 가능한 매니페스트와 버전별 캐시는 로컬·기본 AI를 네트워크 없이 연다", async ({ page, context }) => {
  await ready(page);
  const manifest = await page.request.get("manifest.webmanifest");
  expect(manifest.ok()).toBe(true);
  expect(await manifest.json()).toMatchObject({
    display: "standalone",
    start_url: "./#home",
    scope: "./",
    icons: expect.arrayContaining([expect.objectContaining({ purpose: "maskable", sizes: "512x512" })]),
  });

  const keys = await page.evaluate(async () => {
    const names = await caches.keys();
    return (await Promise.all(names.map(async (name) => (await (await caches.open(name)).keys()).map((request) => request.url)))).flat();
  });
  expect(keys).toEqual(expect.arrayContaining([expect.stringMatching(/\/index\.html$/), expect.stringMatching(/\/assets\/worker-.*\.js$/)]));
  expect(keys.some((url) => /\/api\/|\/auth\/|version\.json|\?/.test(url))).toBe(false);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: /요트다이스를 플레이/ })).toBeVisible();
  await page.goto("#pvp");
  await page.getByRole("button", { name: "주사위 굴리기" }).click();
  await scoreCategory(page, "choice");
  await expect(page.locator(".game-feedback")).toContainText("초이스");
  await page.getByRole("button", { name: "홈으로", exact: true }).click();
  await page.getByRole("dialog", { name: "게임을 나갈까요?" }).getByRole("button", { name: "나가기" }).click();
  await expect(page.getByRole("button", { name: /오프라인 대전/ })).toBeVisible();
  await startAI(page, { algorithm: "Greedy", first: "AI 먼저" });
  await expect(page.getByRole("button", { name: "주사위 굴리기" })).toBeEnabled({ timeout: 15_000 });
});

test("모바일 설치 안내 닫기는 새로고침 뒤에도 유지된다", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "userAgent", { get: () => "iPhone Safari" });
  });
  await page.goto("#home");
  const banner = page.getByRole("complementary", { name: "앱 설치" });
  await banner.getByRole("button", { name: "추가 방법" }).click();
  await expect(banner).toContainText("홈 화면에 추가");
  await banner.getByRole("button", { name: "설치 안내 닫기" }).click();
  await page.reload();
  await expect(banner).toHaveCount(0);
});

test("standalone에서는 설치 안내를 숨긴다", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "userAgent", { get: () => "iPhone Safari" });
    Object.defineProperty(navigator, "standalone", { get: () => true });
  });
  await page.goto("#home");
  await expect(page.getByRole("complementary", { name: "앱 설치" })).toHaveCount(0);
});

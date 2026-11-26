import { expect, test } from "@playwright/test";

/** First-visit tours for the shop and the draw (2026-11-27): short, skippable, looks only. */
test.use({ storageState: { cookies: [], origins: [{ origin: "http://127.0.0.1:5173", localStorage: [{ name: "yachtlab.visited.v1", value: "1" }] }] } });

test("상점 첫 방문: 실제 화면을 가리키는 짧은 안내, 끝까지 넘기면 다시 열리지 않고 사용법으로 다시 볼 수 있다", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (r) => r.method() === "POST" && requests.push(r.url()));
  await page.goto("#shop");
  const card = page.getByRole("dialog", { name: /상점 안내 1\/5/ });
  await expect(card).toBeVisible();
  await expect(card).toContainText("코인과 보석");
  await expect(page.locator(".coach-spot")).toBeVisible();
  for (let i = 2; i <= 5; i++) {
    await page.locator(".coach-card").getByRole("button", { name: /다음/ }).click();
    await expect(page.getByRole("dialog", { name: new RegExp(`상점 안내 ${i}/5`) })).toBeVisible();
  }
  await expect(page.getByRole("dialog", { name: /상점 안내 5\/5/ })).toContainText("확인을 한 번 더");
  await page.locator(".coach-card").getByRole("button", { name: "확인" }).click();
  await expect(page.locator(".coach")).toHaveCount(0);
  expect(requests).toEqual([]); // the tour never buys, upgrades or draws
  await page.reload();
  await page.waitForTimeout(900);
  await expect(page.locator(".coach")).toHaveCount(0);
  await page.getByRole("button", { name: "상점 사용법" }).click();
  await expect(page.getByRole("dialog", { name: /상점 안내 1\/5/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".coach")).toHaveCount(0);
});

test("뽑기 첫 방문: 비용·확률·중복·결과를 설명하고 건너뛸 수 있다", async ({ page }) => {
  await page.goto("#draw");
  const card = page.getByRole("dialog", { name: /뽑기 안내 1\/4/ });
  await expect(card).toBeVisible();
  await expect(card).toContainText("250코인");
  await expect(card).toContainText("하루 5회");
  await page.locator(".coach-card").getByRole("button", { name: /다음/ }).click();
  await expect(page.getByRole("dialog", { name: /뽑기 안내 2\/4/ })).toContainText("7,776");
  await page.locator(".coach-card").getByRole("button", { name: /다음/ }).click();
  await expect(page.getByRole("dialog", { name: /뽑기 안내 3\/4/ })).toContainText("25코인");
  await page.locator(".coach-card").getByRole("button", { name: "건너뛰기", exact: true }).click();
  await expect(page.locator(".coach")).toHaveCount(0);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("yachtlab.coach.v1") ?? "{}"));
  expect(saved.draw).toBeGreaterThan(0);
});

import { test, expect, type Page } from "@playwright/test";

/**
 * C4.3 policy pages. CI's test build is made with LEGAL_PREVIEW=1 (and the dev server always shows
 * drafts), so the draft policy pages are reachable here; the production build is checked separately
 * (deploy.yml: no draft text in dist-pages). The license notice is in every build.
 */
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

test("홈 하단에서 오픈소스 라이선스 고지를 열 수 있다", async ({ page }) => {
  await page.goto("./");
  const links = page.getByRole("navigation", { name: "정책과 안내" }).first();
  await links.getByRole("link", { name: "오픈소스 라이선스" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "오픈소스 라이선스" })).toBeVisible();
  const react = page.locator("details.license-item", { hasText: "react-dom" });
  await react.locator("summary").click();
  await expect(react.locator("pre")).toContainText("MIT License");
  await expect(page.locator("details.license-item", { hasText: "jdh8/yahtzee-engine" })).toContainText("Apache-2.0");
  expect(await noHorizontalScroll(page)).toBe(true);
});

test("정책 초안은 검토 배너와 확인 필요 표시를 보이고, 운영자 정보를 지어내지 않는다", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("navigation", { name: "정책과 안내" }).first().getByRole("link", { name: "개인정보 처리방침" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "개인정보 처리방침" })).toBeVisible();
  await expect(page.getByRole("note")).toContainText("검토용 초안");
  await expect(page.locator(".legal-pending").first()).toBeVisible();
  await expect(page.locator(".legal-body")).not.toContainText("@");
  await expect(page.getByRole("table").first()).toBeVisible();
  expect(await noHorizontalScroll(page)).toBe(true);

  for (const name of ["이용약관", "운영 정책", "문의·개인정보 권리 행사"]) {
    await page.getByRole("navigation", { name: "정책과 안내" }).last().getByRole("link", { name, exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    expect(await noHorizontalScroll(page)).toBe(true);
  }
});

test("설정과 프로필에서도 정책 링크로 이동한다", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("button", { name: "설정", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "설정" });
  await dialog.getByRole("link", { name: "이용약관" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1, name: "이용약관" })).toBeVisible();

  await page.goto("./#profile");
  await page.getByRole("navigation", { name: "정책과 안내" }).last().getByRole("link", { name: "운영 정책" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "운영 정책" })).toBeVisible();
});

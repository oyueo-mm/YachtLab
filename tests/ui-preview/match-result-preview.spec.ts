import { expect, test, type Page } from "@playwright/test";

const open = async (page: Page, scenario: string, reduced = false) => {
  if (reduced) await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`match-result-preview.html?s=${scenario}`);
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  return dialog;
};

test("grand comeback: title, ribbon, profiles, rewards, actions; fits the viewport", async ({ page }) => {
  const dialog = await open(page, "grand");
  await expect(dialog.getByRole("heading", { name: "승리" })).toBeVisible();
  await expect(dialog.locator(".a3-drama-ribbon")).toHaveText("대역전승");
  await expect(dialog.getByText("역전의 명수")).toBeVisible();
  await expect(dialog.getByText("경기 시간 14분 32초")).toBeVisible();
  await expect(dialog.getByText("+13코인")).toBeVisible();
  await expect(dialog.getByText(/첫 요트/)).toBeVisible();
  for (const name of ["재대결", "게임 리뷰", "친구A 님 친구 추가", "공유", "홈으로"]) await expect(dialog.getByRole("button", { name })).toBeVisible();
  const box = await dialog.boundingBox();
  const vp = page.viewportSize()!;
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(vp.width + 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("close and reopen keep the result; Esc closes", async ({ page }) => {
  const dialog = await open(page, "close");
  await dialog.getByRole("button", { name: "결과 닫기" }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole("button", { name: "경기 결과", exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("접전 승리")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "경기 결과", exact: true })).toBeFocused();
});

test("pending, delayed and failed rewards never show amounts", async ({ page }) => {
  for (const [s, text] of [["comeback", "보상을 확인하는 중"], ["close", "정산이 늦어지고"], ["draw", "불러오지 못했어요"]] as const) {
    const dialog = await open(page, s);
    await expect(dialog.getByText(new RegExp(text))).toBeVisible();
    await expect(dialog.getByText(/\+\d+코인/)).toHaveCount(0);
  }
});

test("reduced motion: no burst animation and no running animations in the dialog", async ({ page }) => {
  const dialog = await open(page, "grand", true);
  await expect(dialog.locator(".a3-burst")).toHaveCount(0);
  const running = await page.evaluate(() => document.getAnimations().filter((a) => (a.effect as KeyframeEffect | null)?.target instanceof Element && (a.effect as KeyframeEffect).target!.closest("dialog")).length);
  expect(running).toBe(0);
});

test("multi-player rank and solo record", async ({ page }) => {
  let dialog = await open(page, "field");
  await expect(dialog.getByRole("heading", { name: "공동 2위" })).toBeVisible();
  await expect(dialog.getByRole("list", { name: "최종 순위" }).getByRole("listitem")).toHaveCount(4);
  dialog = await open(page, "solo");
  await expect(dialog.getByRole("heading", { name: "최고 기록 갱신!" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "다시 하기" })).toHaveCount(0); // 1인 미리보기는 재대결 없음
});

test("zero-score popup: neutral text, polite status, disappears by itself", async ({ page }) => {
  await page.goto("match-result-preview.html?s=draw");
  await page.getByRole("dialog").getByRole("button", { name: "결과 닫기" }).click();
  await page.getByRole("button", { name: "요트 0점" }).click();
  const toast = page.locator(".a3-zero-toast");
  await expect(toast).toHaveText(/요트 0점 기록/);
  await expect(toast).toHaveAttribute("aria-live", "polite");
  await expect(toast).toBeHidden({ timeout: 4000 });
});

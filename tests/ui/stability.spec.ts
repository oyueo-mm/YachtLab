import { expect, test } from "@playwright/test";

test("작은 화면과 주소창 높이 변화에서 헤더와 주요 화면 첫 콘텐츠가 겹치지 않는다", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile", "휴대폰 터치 뷰포트에서 확인");
  await page.setViewportSize({ width: 360, height: 800 });
  for (const route of ["home", "online", "offline", "play", "pvp", "shop", "profile", "practice"]) {
    await page.goto("./#" + route);
    const top = page.locator(".shell-top");
    const main = page.locator(".page-" + route);
    await expect(main).toBeVisible();
    for (const height of [800, 620, 568, 800]) {
      await page.setViewportSize({ width: 360, height });
      const [header, content] = await Promise.all([top.boundingBox(), main.boundingBox()]);
      expect(header!.y, route).toBeGreaterThanOrEqual(-1);
      expect(content!.y, route).toBeGreaterThanOrEqual(header!.y + header!.height - 1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth), route).toBeLessThanOrEqual(361);
    }
  }
});

test("설정의 제목과 닫기는 스크롤 바깥에 있고 토글과 선택 상자를 키보드로 조작할 수 있다", async ({ page }, info) => {
  await page.setViewportSize(info.project.name === "mobile" ? { width: 360, height: 460 } : { width: 1000, height: 460 });
  await page.goto("./#play");
  const opener = page.getByRole("button", { name: "설정", exact: true });
  await opener.click();
  const dialog = page.getByRole("dialog", { name: "설정" });
  const close = dialog.getByRole("button", { name: "설정 닫기" });
  const content = dialog.getByRole("region", { name: "설정 항목" });
  await expect(close).toBeFocused();
  const before = await close.boundingBox();
  await content.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  expect(await content.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  expect(await close.boundingBox()).toEqual(before);
  await expect(dialog.getByRole("heading", { name: "도움말" })).toBeInViewport();

  const selector = dialog.getByRole("combobox", { name: "주사위 애니메이션 품질" });
  await selector.scrollIntoViewIfNeeded();
  await selector.focus();
  await page.keyboard.press("Enter");
  const list = dialog.getByRole("listbox", { name: "주사위 애니메이션 품질" });
  await expect(list).toBeVisible();
  const [visible, options] = await Promise.all([content.boundingBox(), list.boundingBox()]);
  expect(options!.y).toBeGreaterThanOrEqual(visible!.y - 1);
  expect(options!.y + options!.height).toBeLessThanOrEqual(visible!.y + visible!.height + 1);
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await expect(selector).toContainText("2.5D");

  const motion = dialog.getByRole("switch", { name: "모션 간단히" });
  const previous = await motion.getAttribute("aria-checked");
  await motion.focus();
  await page.keyboard.press("Space");
  await expect(motion).toHaveAttribute("aria-checked", previous === "true" ? "false" : "true");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
  await page.reload();
  await opener.click();
  await expect(selector).toContainText("2.5D");
});

test("AI 행동 속도 '빠르게'는 PC 클릭과 휴대폰 터치로 선택되고 저장된다", async ({ page }, info) => {
  await page.goto("./#play-setup");
  await page.getByText("고급 설정", { exact: true }).click();
  const speed = page.getByRole("radiogroup", { name: "AI 행동 속도" });
  const label = speed.getByText("빠르게", { exact: true });
  const fast = speed.getByRole("radio", { name: "빠르게" });
  if (info.project.name === "mobile") await label.tap();
  else await label.click();
  await expect(fast).toBeChecked();
  await page.reload();
  await page.getByText("고급 설정", { exact: true }).click();
  await expect(fast).toBeChecked();
});

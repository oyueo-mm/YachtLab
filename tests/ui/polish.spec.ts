import { expect, test, type Page } from "@playwright/test";
import { withMotion } from "./helpers";

/** 2026-11-26 polish: settings sheet, keyboard shortcuts, background music, item effects. */
const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1440) <= 760;
const fxEvents = (page: Page) => page.evaluate(() => ((window as any).__yachtlabFxEvents ?? []).map((e: { type: string }) => e.type));

test("설정은 PC에서 화면 가운데, 휴대폰에서 아래 시트로 열리고 Esc·바깥 클릭으로 닫힌다", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("button", { name: "설정", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "설정" });
  await expect(dialog).toBeVisible();
  const box = (await dialog.boundingBox())!;
  const vp = page.viewportSize()!;
  if (isMobile(page)) expect(Math.abs(box.y + box.height - vp.height)).toBeLessThan(2);
  else {
    expect(Math.abs(box.x + box.width / 2 - vp.width / 2)).toBeLessThan(2);
    expect(Math.abs(box.y + box.height / 2 - vp.height / 2)).toBeLessThan(2);
  }
  // independent music / effects controls
  await expect(dialog.getByRole("slider", { name: "배경 음악 음량" })).toHaveValue("30");
  await expect(dialog.getByRole("slider", { name: "효과음 음량" })).toHaveValue("70");
  await dialog.getByRole("switch", { name: "배경 음악" }).click();
  await expect(dialog.getByRole("slider", { name: "배경 음악 음량" })).toBeDisabled();
  await expect(dialog.getByRole("slider", { name: "효과음 음량" })).toBeEnabled();
  await dialog.getByRole("switch", { name: "전체 음소거" }).click();
  await expect(dialog.getByRole("switch", { name: "효과음" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("yachtlab.settings.v1")!));
  expect(saved).toMatchObject({ muted: true, bgm: false, sfx: true });
  await page.getByRole("button", { name: "설정", exact: true }).click();
  await page.mouse.click(5, 5);
  await expect(dialog).toBeHidden();
});

test("키보드만으로 굴리고 킵하고 족보를 골라 기록하며 입력창·수정키·키 반복은 무시한다", async ({ page }) => {
  test.skip(isMobile(page), "PC keyboard");
  await page.goto("#play");
  await page.locator("body").click({ position: { x: 3, y: 300 } });
  await page.keyboard.press("Control+Space");
  await expect(page.getByRole("button", { name: /주사위 굴리기/ })).toBeVisible();
  await page.keyboard.press("Space");
  await expect(page.locator(".roll-button")).toContainText("2회 남음");
  await page.keyboard.press("1");
  await expect(page.locator('[data-die-id="0"][aria-pressed="true"], [data-die-id="0"] [aria-pressed="true"]')).toHaveCount(1);
  await page.keyboard.press("a");
  await expect(page.locator('button[aria-pressed="true"][data-key]')).toHaveCount(5);
  await page.keyboard.press("d");
  await expect(page.locator('button[aria-pressed="true"][data-key]')).toHaveCount(0);
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(".score-row-selected")).toHaveAttribute("data-category", "aces");
  await page.keyboard.press("Escape");
  await expect(page.locator(".score-row-selected")).toHaveCount(0);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.locator(".game-feedback")).toContainText("듀스 (2)");
  // help sheet
  await page.keyboard.press("Shift+Slash");
  await expect(page.getByRole("dialog", { name: "키보드 단축키" })).toBeVisible();
  await page.keyboard.press("Escape");
});

test("단축키 끄기와 M·B 공통 키가 설정에 저장된다", async ({ page }) => {
  test.skip(isMobile(page), "PC keyboard");
  await page.goto("./");
  await page.locator("body").click({ position: { x: 3, y: 300 } });
  await page.keyboard.press("m");
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("yachtlab.settings.v1")!).muted)).toBe(true);
  await page.keyboard.press("b");
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("yachtlab.settings.v1")!).bgm)).toBe(false);
  await page.evaluate(() => localStorage.setItem("yachtlab.settings.v1", JSON.stringify({ shortcuts: false })));
  await page.goto("#play");
  await page.reload();
  await page.locator("body").click({ position: { x: 3, y: 300 } });
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: /주사위 굴리기/ })).toBeVisible();
});

test("배경 음악은 첫 상호작용 뒤 화면별로 하나만 재생되고 끄면 멈춘다", async ({ page }) => {
  await page.goto("./");
  expect(await page.evaluate(() => (window as any).__yachtlabBgm.live)).toBe(0); // autoplay policy: nothing before a gesture
  await page.locator("body").click({ position: { x: 3, y: 300 } });
  await expect.poll(() => page.evaluate(() => (window as any).__yachtlabBgm.scene), { timeout: 15000 }).toBe("home");
  await page.goto("#shop");
  await page.locator("body").click({ position: { x: 3, y: 300 } });
  await expect.poll(() => page.evaluate(() => (window as any).__yachtlabBgm.scene), { timeout: 15000 }).toBe("shop");
  await page.evaluate(() => (window.location.hash = "#offline"));
  await expect.poll(() => page.evaluate(() => (window as any).__yachtlabBgm.scene), { timeout: 15000 }).toBe("home");
  await page.waitForTimeout(2200); // crossfade finished: the old track stopped
  expect(await page.evaluate(() => (window as any).__yachtlabBgm.live)).toBe(1);
  await page.getByRole("button", { name: "설정", exact: true }).click();
  await page.getByRole("switch", { name: "배경 음악" }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__yachtlabBgm.scene)).toBe("none");
});

test("상점 미리보기: 네온 주사위 Lv.3 효과·보드 반응·이모티콘 전용 연출이 실제 게임과 같은 계층으로 재생된다", async ({ page }) => {
  await withMotion(page);
  await page.goto("#shop");
  await page.getByRole("tab", { name: /^주사위/ }).click();
  await page.getByRole("button", { name: "네온 핑크 자세히" }).click();
  let dialog = page.getByRole("dialog", { name: "네온 핑크 상세" });
  await dialog.getByRole("tab", { name: /^Lv\.3/ }).click();
  await expect(dialog.getByRole("tab", { name: /^Lv\.3/ })).toContainText("네온 파동");
  await dialog.getByRole("button", { name: "굴려 보기" }).click();
  await expect.poll(() => fxEvents(page), { timeout: 8000 }).toContain("land");
  await expect(dialog.locator(".dice-trail-canvas")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: /^보드판/ }).click();
  await page.getByRole("button", { name: "심해 자세히" }).click();
  dialog = page.getByRole("dialog", { name: "심해 상세" });
  await dialog.getByRole("tab", { name: /^Lv\.3/ }).click();
  await expect(dialog.locator(".board-fx-canvas")).toHaveCount(1); // one canvas: scene + particles (A1)
  await dialog.getByRole("button", { name: "승리 반응" }).click();
  await expect.poll(() => fxEvents(page)).toContain("win");
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: /^이모티콘/ }).click();
  await page.getByRole("button", { name: "대단해요 자세히" }).click();
  dialog = page.getByRole("dialog", { name: "대단해요 상세" });
  await dialog.getByRole("tab", { name: /^Lv\.2/ }).click();
  await expect(dialog.locator(".stage-feed .emote-glyph")).toHaveAttribute("data-anim", "flicker");
  await dialog.getByRole("tab", { name: /^Lv\.3/ }).click();
  await expect(dialog.locator(".stage-feed .emote-glyph.lv3")).toHaveCount(1);
  const sounds = () => page.evaluate(() => (window as any).__yachtlabSound.log.map((x: { name: string }) => x.name));
  await expect.poll(sounds).toContain("emoteLv3");
});

import { expect, test, type Page } from "@playwright/test";
import { withMotion } from "./helpers";

/** FX-1: physical dice materials, motion-reactive Lv.2+ glow, the shared preview stage and resource cleanup. */
const sounds = (page: Page) => page.evaluate(() => (window as any).__yachtlabSound.log.map((x: { name: string; pack?: string }) => [x.name, x.pack ?? ""]));

async function openDice(page: Page, name: string) {
  await page.goto("#shop");
  await page.getByRole("tab", { name: /^주사위/ }).click();
  await page.getByRole("button", { name: `${name} 자세히` }).click();
  return page.getByRole("dialog", { name: `${name} 상세` });
}

test("상점 미리보기: 재질이 렌더러와 소리에 같이 적용되고, Lv.3에서 요트·스트레이트 연출이 경기와 같은 경로로 재생된다", async ({ page }) => {
  test.skip(test.info().project.name === "mobile", "one viewport is enough for the data paths");
  // The full material tier (what a GPU device starts with); headless Chromium is software GL → tier 2 by default.
  await page.addInitScript(() => sessionStorage.setItem("yachtlab.dice.material", "0"));
  await withMotion(page, "3d-high");
  const dialog = await openDice(page, "황금");
  const canvas = dialog.locator(".dice-table-canvas");
  await expect(canvas).toHaveAttribute("data-material", "metal");
  await dialog.getByRole("button", { name: "굴려 보기" }).click();
  await expect.poll(() => sounds(page)).toContainEqual(["impact", "gold"]);
  await dialog.getByRole("tab", { name: /^Lv\.3/ }).click();
  // Lv.3: the theme layer wakes with the throw (separate from the physical sound), then the landing accent.
  await expect.poll(() => sounds(page).then((s) => s.map((x: string[]) => x[0])), { timeout: 8000 }).toContain("diceFxRoll");
  await expect.poll(() => sounds(page).then((s) => s.map((x: string[]) => x[0])), { timeout: 8000 }).toContain("diceFx");
  // Lv.2+ glow followed the dice's motion (multiplier above 1 during the throw), then faded by itself.
  await expect(canvas).toHaveAttribute("data-glow-peak", /^(?!1\.00)\d+\.\d\d$/, { timeout: 8000 });
  await dialog.getByRole("button", { name: "요트 연출" }).click();
  await expect.poll(() => page.evaluate(() => ((window as any).__yachtlabYacht ?? []).length), { timeout: 8000 }).toBeGreaterThan(0);
  await expect.poll(() => sounds(page).then((s) => s.map((x: string[]) => x[0])), { timeout: 8000 }).toContain("yachtHit");
  await dialog.getByRole("button", { name: "스트레이트 연출" }).click();
  await expect.poll(() => page.evaluate(() => ((window as any).__yachtlabStraight ?? []).length), { timeout: 8000 }).toBeGreaterThan(0);
});

test("재질 종류: 유리·보석·나무·대리석이 서로 다른 재질로 그려진다", async ({ page }) => {
  test.skip(test.info().project.name === "mobile", "data check");
  await withMotion(page, "3d-high");
  for (const [name, cls] of [["블루 글라스", "glass"], ["루비", "gem"], ["원목", "wood"], ["흰 대리석", "stone"], ["홀로그램", "resin"]] as const) {
    const dialog = await openDice(page, name);
    await expect(dialog.locator(".dice-table-canvas")).toHaveAttribute("data-material", cls);
    await page.keyboard.press("Escape");
  }
});

test("성능 우선(3d)에서는 물리 재질 레이어를 끄고, 상세 창을 여러 번 열고 닫아도 WebGL 컨텍스트가 남지 않는다", async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as any;
    w.__gl = { created: 0, lost: 0 };
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      const ctx = (orig as any).call(this, type, ...rest);
      if (ctx && /webgl/.test(type) && !(this as any).__counted) {
        (this as any).__counted = true;
        w.__gl.created++;
        this.addEventListener("webglcontextlost", () => w.__gl.lost++);
      }
      return ctx;
    } as any;
  });
  await withMotion(page, "3d");
  for (let i = 0; i < 4; i++) {
    const dialog = await openDice(page, "홀로그램");
    await expect(dialog.locator(".dice-table-canvas")).toHaveAttribute("data-physical", "false");
    await dialog.getByRole("button", { name: "굴려 보기" }).click();
    await page.waitForTimeout(400);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  }
  const gl = await page.evaluate(() => (window as any).__gl);
  expect(gl.created).toBeGreaterThanOrEqual(4);
  expect(gl.created - gl.lost).toBeLessThanOrEqual(1);
});

test("소프트웨어 GL(CPU 래스터)에서는 가장 가벼운 재질 단계로 시작하고 움직임 반응을 끈다", async ({ page }) => {
  test.skip(test.info().project.name === "mobile", "data check");
  await withMotion(page, "3d-high");
  const dialog = await openDice(page, "황금");
  const canvas = dialog.locator(".dice-table-canvas");
  await expect(canvas).toHaveAttribute("data-material-tier", "2");
  await expect(canvas).toHaveAttribute("data-physical", "false");
  await expect(canvas).toHaveAttribute("data-material", "metal"); // the material identity is kept
});

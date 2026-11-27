import { expect, test, type Page } from "@playwright/test";
import { withMotion } from "./helpers";

/** A1 (2026-11-27): dice hover, board surfaces, board Lv.2 / Lv.3 scenes, synergy paths, shop level preview. */
async function ownLook(page: Page, look: Record<string, unknown>, settings: Record<string, unknown> = {}) {
  await page.route(/workers\.dev|\/api\//, (route) => route.abort());
  await page.addInitScript(([l, s]) => {
    const u = "u_" + "a".repeat(22);
    localStorage.setItem("yachtlab.session.v1", "s1." + u + "." + "b".repeat(43));
    localStorage.setItem("yachtlab.own-look.v1", JSON.stringify({ account: u, look: { emotes: [], chats: [], ...l } }));
    localStorage.setItem("yachtlab.settings.v1", JSON.stringify({ muted: true, ...s }));
  }, [look, settings] as const);
}
const boardFrames = (page: Page) => page.evaluate(() => (window as unknown as { __yachtlabBoardFx?: { frames: number } }).__yachtlabBoardFx?.frames ?? 0);
const fxEvents = (page: Page) => page.evaluate(() => ((window as unknown as { __yachtlabFxEvents?: { type: string; strength?: number }[] }).__yachtlabFxEvents ?? []).map((e) => ({ type: e.type, strength: e.strength })));
/** Share of non-transparent pixels on a 2D canvas. */
const inked = (page: Page, selector: string) =>
  page.evaluate((sel) => {
    const c = document.querySelector<HTMLCanvasElement>(sel);
    const g = c?.getContext("2d");
    if (!c || !g || !c.width) return 0;
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 16) if (d[i] > 8) n++;
    return n / (d.length / 16);
  }, selector);

test("주사위에 마우스를 올려도 주황 테두리가 생기지 않고, 선택·키보드 포커스 표시는 남는다", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "hover needs a mouse");
  await withMotion(page, "3d");
  await ownLook(page, {});
  await page.goto("#solo");
  await page.locator(".roll-button").click();
  const die = page.locator('.die-hit[data-die-id="0"]');
  await expect(die).toBeEnabled({ timeout: 8000 });
  const border = () => die.evaluate((n) => getComputedStyle(n).borderTopColor);
  await page.mouse.move(2, 2);
  const before = await border();
  await die.hover();
  await page.waitForTimeout(250);
  expect(await border()).toBe(before);
  // keyboard focus keeps its ring
  await die.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  const outline = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement;
    return el?.classList.contains("die-hit") ? getComputedStyle(el).outlineStyle : "n/a";
  });
  expect(["solid", "n/a"]).toContain(outline);
  // selection still shows (held)
  await die.click();
  await expect(die).toHaveAttribute("aria-pressed", "true");
});

test("2.5D 주사위 줄에서도 hover 테두리 변화가 없다", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "hover needs a mouse");
  await withMotion(page, "2.5d");
  await ownLook(page, {}, { diceQuality: "2.5d" });
  await page.goto("#solo");
  await page.locator(".roll-button").click();
  const die = page.locator(".dice-row .die-button").first();
  await expect(die).toBeEnabled({ timeout: 8000 });
  await page.mouse.move(2, 2);
  const before = await die.evaluate((n) => getComputedStyle(n).borderTopColor);
  await die.hover();
  await page.waitForTimeout(250);
  expect(await die.evaluate((n) => getComputedStyle(n).borderTopColor)).toBe(before);
});

test("보드 Lv.1은 효과 캔버스 없이 표면 재질만 알리고, Lv.2는 굴리지 않아도 한 캔버스에서 계속 움직인다", async ({ page }) => {
  await withMotion(page);
  await ownLook(page, { board: "board.felt_red", boardLv: 1 });
  await page.goto("#solo");
  await expect(page.locator(".game-board")).toHaveAttribute("data-surface", "felt");
  await expect(page.locator(".board-fx-canvas")).toHaveCount(0);
  await page.goto("about:blank");
  await ownLook(page, { board: "board.meadow", boardLv: 2 });
  await page.goto("#solo");
  await expect(page.locator(".game-board")).toHaveAttribute("data-surface", "grass");
  await expect(page.locator(".board-fx-canvas")).toHaveCount(1);
  await expect(page.locator(".game-board")).toHaveAttribute("data-board-fx", "lv2");
  const f0 = await boardFrames(page);
  await page.waitForTimeout(1200);
  expect(await boardFrames(page)).toBeGreaterThan(f0 + 15); // ~30 fps environment at rest
  expect(await inked(page, ".board-fx-canvas")).toBeGreaterThan(0.01);
});

test("보드 Lv.3은 실제 충돌 세기를 받은 이벤트에 반응하고, 동작 줄이기에서는 꺼진다", async ({ page }) => {
  await withMotion(page);
  await ownLook(page, { board: "board.storm", boardLv: 3 });
  await page.goto("#solo");
  await expect(page.locator(".game-board")).toHaveAttribute("data-board-fx", "lv3");
  await page.locator(".roll-button").click();
  await expect.poll(async () => (await fxEvents(page)).filter((e) => e.type === "impact").length, { timeout: 8000 }).toBeGreaterThan(0);
  const impacts = (await fxEvents(page)).filter((e) => e.type === "impact");
  for (const e of impacts) expect(e.strength).toBeGreaterThan(1.6);
  await expect(page.locator(".board-fx-canvas")).toHaveCount(1);
  await page.goto("about:blank");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await ownLook(page, { board: "board.storm", boardLv: 3 });
  await page.goto("#solo");
  await expect(page.locator(".game-board")).toHaveAttribute("data-surface", "stone");
  await expect(page.locator(".board-fx-canvas")).toHaveCount(0);
});

test("시너지는 보드 효과와 별도 캔버스에서 주사위가 지나간 길을 그린다", async ({ page }) => {
  await withMotion(page, "3d");
  await ownLook(page, { dice: "dice.lava", diceLv: 1, board: "board.volcano", boardLv: 2 });
  await page.goto("#solo");
  await expect(page.locator(".game-board")).toHaveAttribute("data-synergy", "lava");
  await expect(page.locator(".board-synergy-canvas")).toHaveCount(1);
  await expect(page.locator(".board-fx-ambient")).toHaveCount(1);
  await page.locator(".roll-button").click();
  // while the dice travel, the molten track appears on the synergy canvas
  await expect.poll(() => inked(page, ".board-synergy-canvas"), { timeout: 4000 }).toBeGreaterThan(0.002);
});

test("상점 보드 상세: Lv.1/2/3 탭이 실제 단계를 그리고, Lv.3을 고르면 바로 굴려 반응을 보여 준다", async ({ page }) => {
  await withMotion(page);
  await page.goto("#shop");
  await page.getByRole("tab", { name: /^보드판/ }).click();
  await page.getByRole("button", { name: "얼음 자세히" }).click();
  const dialog = page.getByRole("dialog", { name: "얼음 상세" });
  await expect(dialog.locator(".board-fx-canvas")).toHaveCount(0);
  await dialog.getByRole("tab", { name: /^Lv\.2/ }).click();
  await expect(dialog.locator(".board-fx-canvas")).toHaveAttribute("data-level", "2");
  const rolls = async () => (await fxEvents(page)).filter((e) => e.type === "roll").length;
  const before = await rolls();
  await dialog.getByRole("tab", { name: /^Lv\.3/ }).click();
  await expect(dialog.locator(".board-fx-canvas")).toHaveAttribute("data-level", "3");
  await expect.poll(rolls, { timeout: 8000 }).toBeGreaterThan(before);
  await expect(dialog.getByRole("tab", { name: /^Lv\.3/ })).toContainText("금이 가고");
});

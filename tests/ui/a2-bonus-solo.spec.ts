import { expect, test, type Page } from "@playwright/test";
import { withMotion } from "./helpers";

/**
 * Upper bonus in the REAL 1인 플레이 game. The seed is fixed (7: chasing the upper section with the
 * policy below reaches 63+ by the sixth upper category; found by tests of the engine, see
 * tests/bonus-moment.test.ts for the trigger rules). The game is driven through the real UI: roll, hold the
 * dice that show the target number, roll again, record the target. The popup must appear once when the
 * 63rd point is recorded, the sheet cell highlights, sound is logged once, the next throw still works
 * (the popup never blocks input), and nothing plays when the screen is opened on an existing bonus.
 */
const SEED = 7;
const VALUE: Record<string, number> = { aces: 1, deuces: 2, threes: 3, fours: 4, fives: 5, sixes: 6 };
const UPPER = Object.keys(VALUE);

async function dice(page: Page) {
  return page.locator(".die-button").evaluateAll((els) => els.map((e) => {
    const m = /주사위 (\d+), (\d+), (고정됨|고정 안 됨)/.exec(e.getAttribute("aria-label") ?? "");
    return { id: Number(m?.[1]) - 1, value: Number(m?.[2]), held: m?.[3] === "고정됨" };
  }));
}
async function roll(page: Page) {
  const before = await page.locator(".solo-summary .round strong").textContent();
  void before;
  await page.locator(".roll-button").click();
}
async function record(page: Page, category: string) {
  await page.locator(`[data-category="${category}"] .score-option`).click();
  const ok = page.getByRole("button", { name: "점수 기록 확정" });
  if (await ok.isVisible().catch(() => false)) await ok.click();
}

test("1인 플레이: 상단 63점에 처음 도달할 때 BONUS! +35점이 한 번만 나오고 조작을 막지 않는다", async ({ page }, info) => {
  test.skip(info.project.name === "mobile", "scripted desktop run");
  test.setTimeout(120_000);
  await withMotion(page);
  await page.addInitScript((seed) => {
    localStorage.setItem("yachtlab.settings.v1", JSON.stringify({ muted: false, volume: 0.4, diceQuality: "2.5d" }));
    const orig = crypto.getRandomValues.bind(crypto);
    (crypto as unknown as { getRandomValues: (a: ArrayBufferView) => ArrayBufferView }).getRandomValues = (a: ArrayBufferView) => {
      if (a instanceof Uint32Array && a.length === 1) { a[0] = seed; return a; }
      return orig(a as Uint8Array);
    };
  }, SEED);
  await page.goto("#solo");
  await expect(page.locator(".solo-scores .scoreboard")).toBeVisible();
  const bonusShown = () => page.evaluate(() => (window as unknown as { __yachtlabBonus?: unknown[] }).__yachtlabBonus?.length ?? 0);
  const bonusSounds = () => page.evaluate(() => (window as unknown as { __yachtlabSound: { log: { name: string }[] } }).__yachtlabSound.log.filter((e) => e.name === "bonusHit").length);
  let upperTotal = 0;
  let firedAt = -1;
  const open = new Set(UPPER);
  for (let round = 1; round <= 6; round++) {
    await roll(page);
    let d = await expectSettled(page);
    // policy (same as the seed search): chase the open upper number with the most dice (ties: higher)
    const target = [...open].map((c) => ({ c, v: VALUE[c], n: d.filter((x) => x.value === VALUE[c]).length })).sort((a, b) => b.n - a.n || b.v - a.v)[0];
    for (let throwNo = 0; throwNo < 2; throwNo++) {
      for (const x of d.filter((x) => x.value === target.v && !x.held)) await page.locator(".die-button").nth(x.id).click();
      d = await dice(page);
      if (d.every((x) => x.held)) break;
      await roll(page);
      d = await expectSettled(page);
    }
    // record the target
    const gained = d.filter((x) => x.value === target.v).length * target.v;
    await record(page, target.c);
    open.delete(target.c);
    upperTotal += gained;
    await expect(page.locator(`[data-category="${target.c}"] .fixed-score`)).toHaveText(String(gained));
    if (upperTotal >= 63 && firedAt < 0) {
      firedAt = round;
      const pop = page.locator(".bonus-pop");
      await expect(pop).toBeVisible();
      await expect(pop).toContainText("BONUS!");
      await expect(pop).toContainText("+35점");
      await expect(page.locator(".scoreboard .bonus-progress")).toHaveClass(/just/);
      expect(await bonusShown()).toBe(1);
      expect(await bonusSounds()).toBe(1);
      // the next throw works while the popup is still up (pointer-events none)
      expect(await pop.evaluate((n) => getComputedStyle(n.closest(".bonus-moment")!).pointerEvents)).toBe("none");
      await expect(page.locator(".roll-button")).toBeEnabled();
    } else if (firedAt < 0) {
      await expect(page.locator(".bonus-pop")).toHaveCount(0);
      expect(await bonusShown()).toBe(0);
    }
  }
  expect(firedAt).toBeGreaterThan(0);
  expect(await bonusShown()).toBe(1); // once per game, no matter how many more rounds
  await page.screenshot({ path: "docs/ui/a2-2026-11/after/bonus-solo.png" });
});

/** The dice stop moving: aria labels are stable for a moment. */
async function expectSettled(page: Page) {
  let last = "";
  let stable = 0;
  for (let i = 0; i < 60 && stable < 3; i++) {
    await page.waitForTimeout(120);
    const d = await dice(page);
    const sig = JSON.stringify(d.map((x) => x.value));
    stable = sig === last && !(await page.locator(".die-button.dice-animating").count()) ? stable + 1 : 0;
    last = sig;
  }
  return dice(page);
}

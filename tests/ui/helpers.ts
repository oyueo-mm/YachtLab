import { expect, type Page } from "@playwright/test";
import { gameDifficulties } from "../../src/GameDifficulty";

export async function chooseAlgorithm(page: Page, label: string, value: string) {
  const box = page.getByRole("combobox", { name: label, exact: true });
  if (await box.evaluate((node) => node.tagName === "SELECT")) {
    await box.selectOption(value);
    return;
  }
  await box.click();
  const option = page.getByRole("option", { name: value, exact: true });
  if (!(await option.isVisible())) {
    for (const tier of ["매우 쉬움", "쉬움", "보통", "어려움", "매우 어려움"]) {
      await page.getByRole("button", { name: tier, exact: true }).click();
      if (await option.isVisible()) break;
    }
  }
  await option.click();
}

export async function scoreCategory(page: Page, category?: string) {
  const mobile = (page.viewportSize()?.width ?? 1024) <= 760;
  if (mobile) {
    await page.getByRole("button", { name: "점수판 열기" }).click();
    const dialog = page.getByRole("dialog", { name: "점수판" });
    await dialog.locator(category ? `[data-category="${category}"] .score-option` : `.score-option`).first().click();
  } else {
    await page.locator(category ? `[data-category="${category}"] .score-option` : `.score-option`).first().click();
  }
}

type AiOptions = { algorithm?: string; name?: string; first?: "무작위" | "내가 먼저" | "AI 먼저" };
/** Human vs AI through the setup screen (the play screen has no settings anymore). */
export async function startAI(page: Page, options: AiOptions = {}) {
  const level = gameDifficulties.find((d) => d.algorithm === options.algorithm);
  await page.goto(options.algorithm && !level ? "?lab=1#play-setup" : "#play-setup");
  if (options.algorithm) {
    if (level) await page.getByRole("radiogroup", { name: "AI 난이도" }).getByText(level.name, { exact: true }).click();
    else {
      await page.getByText("고급 설정", { exact: true }).click();
      await page.getByText("연구용 알고리즘 직접 선택").click();
      await chooseAlgorithm(page, "연구용 알고리즘", options.algorithm);
    }
  }
  if (options.name !== undefined) await page.getByLabel("내 이름").fill(options.name);
  if (options.first) await page.getByRole("radiogroup", { name: "선공" }).getByText(options.first, { exact: true }).click();
  await page.getByRole("button", { name: "게임 시작" }).click();
  await expect(page.getByRole("region", { name: "게임 보드" })).toBeVisible();
}

type LocalOptions = { count?: number; names?: string[]; order?: "입력한 순서" | "무작위" };
/** Local multiplayer through the setup screen. Counts above 4 use the advanced section. */
export async function startLocal(page: Page, options: LocalOptions = {}) {
  await page.goto("#pvp-setup");
  const count = options.count ?? 2;
  if (count <= 4) await page.getByRole("radiogroup", { name: "참가 인원" }).getByText(`${count}명`, { exact: true }).click();
  else {
    const advanced = page.locator(".setup-advanced");
    if (!(await advanced.evaluate((d) => (d as HTMLDetailsElement).open))) await advanced.locator("summary").click();
    await page.getByLabel("참가 인원 직접 입력").fill(String(count));
  }
  for (const [i, name] of (options.names ?? []).entries()) await page.getByLabel(`플레이어 ${i + 1} 이름`).fill(name);
  if (options.order) await page.getByRole("radiogroup", { name: "시작 순서" }).getByText(options.order, { exact: true }).click();
  await page.getByRole("button", { name: "게임 시작" }).click();
  await expect(page.getByRole("region", { name: "사람 vs 사람 게임 보드" })).toBeVisible();
}

/** Opt a test back into dice motion (the suite runs with reduced motion by default for speed). */
export async function withMotion(page: Page, quality: "auto" | "3d-high" | "3d" | "2.5d" = "auto") {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  if (quality !== "auto")
    await page.addInitScript((q) => {
      try {
        const key = "yachtlab.settings.v1";
        const current = JSON.parse(localStorage.getItem(key) || "{}");
        localStorage.setItem(key, JSON.stringify({ ...current, diceQuality: q }));
      } catch {
        // ignore
      }
    }, quality);
}

/** First-roll combinations (player 0) for fixed game seeds — found by search over the real engine. */
export const SEEDS = { threes: 3, full: 20, large: 29, four: 45, yacht: 563, smallNoDup: 5900, none: 6515, small12341: 10173 } as const;
/** Make every new game use this seed (the games read `crypto.getRandomValues(new Uint32Array(1))`). */
export async function fixSeed(page: Page, seed: number) {
  await page.addInitScript((value) => {
    const original = crypto.getRandomValues.bind(crypto);
    crypto.getRandomValues = ((array: ArrayBufferView) => {
      if (array instanceof Uint32Array && array.length === 1) {
        array[0] = value;
        return array;
      }
      return original(array as Uint8Array);
    }) as typeof crypto.getRandomValues;
  }, seed);
}

/** Set the nickname this browser uses online (it is edited on the profile page, not on the online screens). */
export async function nick(page: import("@playwright/test").Page, name: string) {
  await page.evaluate((n) => {
    localStorage.setItem("yachtlab.online.name", n);
    window.dispatchEvent(new Event("yachtlab-nickname"));
  }, name);
}

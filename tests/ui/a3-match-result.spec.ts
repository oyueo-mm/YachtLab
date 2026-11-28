import { expect, test, type Page } from "@playwright/test";
import { fixSeed, scoreCategory, startAI, startLocal } from "./helpers";

/**
 * A3 결과 화면·0점 팝업을 실제 게임 UI로 검증한다 (1인·사람 vs AI·로컬 다인전).
 * 역전·접전 경기는 고정 시드 1에서 한 번씩만 굴려 기록하는 실제 경기다. 칸 순서는 실제 엔진으로
 * 찾은 값이며(주사위는 칸 선택과 무관), 판정은 화면이 기보에서 직접 한다.
 */
const PLANS = {
  grand: [
    ["large", "yacht", "deuces", "four", "sixes", "small", "aces", "threes", "full", "choice", "fives", "fours"],
    ["aces", "choice", "threes", "fives", "four", "small", "fours", "sixes", "deuces", "large", "yacht", "full"],
  ],
  close: [
    ["deuces", "sixes", "threes", "four", "full", "choice", "fives", "large", "small", "yacht", "fours", "aces"],
    ["choice", "fives", "deuces", "four", "yacht", "full", "small", "threes", "sixes", "large", "fours", "aces"],
  ],
  finalTurn: [
    ["deuces", "fours", "full", "sixes", "threes", "small", "large", "aces", "four", "yacht", "fives", "choice"],
    ["fives", "full", "four", "sixes", "threes", "large", "fours", "choice", "yacht", "deuces", "aces", "small"],
  ],
} as const;

async function playLocalPlan(page: Page, plan: readonly (readonly string[])[], onTurn?: (turn: number) => Promise<void>) {
  for (let t = 0; t < 24; t++) {
    await page.getByRole("button", { name: "주사위 굴리기" }).click();
    await scoreCategory(page, plan[t % 2][Math.floor(t / 2)]);
    await onTurn?.(t);
  }
}

const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

test("로컬 2인 대역전승: 실제 기보로 판정, 0점 팝업, 닫기·다시 열기, 모바일 폭", async ({ page }) => {
  test.setTimeout(120_000);
  await fixSeed(page, 1);
  await startLocal(page, { count: 2, names: ["가람", "나래"], order: "입력한 순서" });
  await playLocalPlan(page, PLANS.grand, async (t) => {
    if (t === 0) {
      const toast = page.locator(".a3-zero-toast");
      await expect(toast).toHaveText(/가람 · 라지 스트레이트 0점 기록/);
      await expect(toast).toHaveAttribute("aria-live", "polite");
      await expect(toast).not.toContainText(/실패|아쉽|실수/);
    }
  });
  const dialog = page.getByRole("dialog", { name: "가람 승리" });
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await expect(dialog.locator(".a3-drama-ribbon")).toHaveText("대역전승");
  await expect(dialog.getByRole("list", { name: "경기 하이라이트" })).toContainText("8라운드 50점 차를 뒤집었어요");
  await expect(dialog.getByRole("list", { name: "최종 순위" }).getByRole("listitem")).toHaveCount(2);
  await expect(dialog.locator("li.winner")).toContainText("60");
  await expect(dialog).not.toContainText(/정확도|실수|운 점수/);
  // 로컬은 보상이 없는 모드: 보상 칸 없음
  await expect(dialog.locator(".a3-rewards, .a3-reward-note")).toHaveCount(0);
  expect(await noHorizontalScroll(page)).toBe(true);
  const box = (await dialog.boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  // 닫기 → 다시 열기 → Esc
  await dialog.getByRole("button", { name: "결과 닫기" }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole("button", { name: "경기 결과", exact: true }).click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  // 재대결: 결과·0점 팝업이 다시 나오지 않고 새 경기가 시작된다
  await page.getByRole("button", { name: "경기 결과", exact: true }).click();
  await dialog.getByRole("button", { name: "한 번 더 플레이" }).click();
  await expect(page.locator(".a3-result-dialog[open]")).toHaveCount(0);
  await expect(page.locator(".a3-zero-toast")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "경기 결과", exact: true })).toHaveCount(0);
});

test("로컬 2인 접전 승리와 마지막 차례 역전", async ({ page }) => {
  test.setTimeout(150_000);
  await fixSeed(page, 1);
  await startLocal(page, { count: 2, names: ["가람", "나래"], order: "입력한 순서" });
  await playLocalPlan(page, PLANS.close);
  let dialog = page.getByRole("dialog", { name: "가람 승리" });
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await expect(dialog.locator(".a3-drama-ribbon")).toHaveCount(0);
  await expect(dialog.locator('[data-kind="close"]')).toContainText("접전 승리");
  await expect(dialog.locator('[data-kind="close"]')).toContainText("4점 차");
  await dialog.getByRole("button", { name: "한 번 더 플레이" }).click();
  await playLocalPlan(page, PLANS.finalTurn);
  dialog = page.getByRole("dialog", { name: "가람 승리" });
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await expect(dialog.locator(".a3-drama-ribbon")).toHaveText("마지막 차례 역전");
});

test("사람 vs AI: 결과 창, 기본음 1회, 리뷰 진입, 재대결·새로고침 뒤 중복 없음", async ({ page }) => {
  test.setTimeout(120_000);
  await startAI(page, { algorithm: "Random", first: "내가 먼저" });
  for (let round = 0; round < 12; round++) {
    await expect(page.getByRole("button", { name: "주사위 굴리기" })).toBeEnabled({ timeout: 15_000 });
    await page.getByRole("button", { name: "주사위 굴리기" }).click();
    await scoreCategory(page);
  }
  const dialog = page.locator(".a3-result-dialog");
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await expect(dialog.getByRole("heading", { level: 2 })).toHaveText(/^(승리|패배|무승부)$/);
  await expect(dialog.getByRole("list", { name: "최종 순위" }).getByRole("listitem")).toHaveCount(2);
  await expect(dialog.locator("li.you")).toBeVisible();
  for (const name of ["한 번 더 플레이", "게임 리뷰", "나가기"]) await expect(dialog.getByRole("button", { name })).toBeVisible();
  await expect(dialog.getByRole("button", { name: /공유/ })).toBeVisible();
  // 승패 기본음은 경기 종료 때 한 번만(결과 창이 같은 소리를 다시 내지 않음). 다시 열어도 소리 없음.
  const outcomeSounds = () => page.evaluate(() => (window as unknown as { __yachtlabSound: { log: { name: string }[] } }).__yachtlabSound.log.filter((e) => ["win", "lose", "draw", "winShared"].includes(e.name)).length);
  expect(await outcomeSounds()).toBe(1);
  await dialog.getByRole("button", { name: "결과 닫기" }).click();
  await page.getByRole("button", { name: "경기 결과", exact: true }).click();
  expect(await outcomeSounds()).toBe(1);
  // 게임 리뷰 진입 (자동 분석 없이 버튼으로만)
  await dialog.getByRole("button", { name: "게임 리뷰" }).click();
  await expect(page.locator("dialog.review-page")).toBeVisible({ timeout: 20_000 });
  await page.keyboard.press("Escape");
  // 재대결: 결과 창·하이라이트가 남지 않음
  await page.getByRole("button", { name: "경기 결과", exact: true }).click();
  await dialog.getByRole("button", { name: "한 번 더 플레이" }).click();
  await expect(page.locator(".a3-result-dialog[open]")).toHaveCount(0);
  await expect(page.locator(".scoreboard .fixed-score")).toHaveCount(0);
  // 새로고침: 지난 경기 결과·0점 팝업을 다시 띄우지 않음
  await page.reload();
  await expect(page.locator(".a3-result-dialog[open]")).toHaveCount(0);
  await expect(page.locator(".a3-zero-toast")).toHaveCount(0);
});

test("장착한 승리 효과가 기본 축하 조각보다 우선한다 (1인 첫 기록)", async ({ page }) => {
  test.setTimeout(120_000);
  test.skip((page.viewportSize()?.width ?? 1024) <= 760, "데스크톱에서 한 번");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.addInitScript(() => {
    const account = "u_" + "a".repeat(22);
    localStorage.setItem("yachtlab.session.v1", `s1.${account}.${"b".repeat(43)}`);
    localStorage.setItem("yachtlab.own-look.v1", JSON.stringify({ account, look: { dice: "dice.classic", board: "board.charcoal", bubble: "bubble.basic", profile: "profile.die", nameFx: "nameFx.none", nameFxLv: 1, fx: "fx.confetti", fxLv: 2, title: "title.none", emotes: [], chats: [] } }));
    const s = JSON.parse(localStorage.getItem("yachtlab.settings.v1") || "{}");
    localStorage.setItem("yachtlab.settings.v1", JSON.stringify({ ...s, diceQuality: "2.5d" }));
  });
  await page.goto("#solo");
  await expect(page.getByRole("region", { name: "1인 플레이 게임 보드" })).toBeVisible();
  for (let round = 0; round < 12; round++) {
    await page.getByRole("button", { name: "주사위 굴리기" }).click();
    await expect(page.locator(".score-option").first()).toBeVisible({ timeout: 15_000 });
    await scoreCategory(page);
  }
  const dialog = page.getByRole("dialog", { name: "첫 기록 완성" });
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".a3-result-dialog")).toHaveAttribute("data-effect", "item");
  await expect(dialog.locator(".a3-burst")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "바로 다시 도전" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "게임 리뷰" })).toBeVisible();
});

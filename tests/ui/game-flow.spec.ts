import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { scoreCategory, startAI, startLocal, withMotion } from "./helpers";

type DebugRoll = { mode: string; token: number; targets: Record<string, number>; finals?: Record<string, number>; endedAt?: number };
const lastRoll = (page: Page) => page.evaluate(() => (window as unknown as { __yachtlabDice?: { last: DebugRoll } }).__yachtlabDice?.last ?? null);
const domFaces = (page: Page) =>
  page.locator(".die-button").evaluateAll((nodes) =>
    Object.fromEntries(
      nodes.map((n) => {
        const [, id, value] = /주사위 (\d), (\d)/.exec(n.getAttribute("aria-label")!)!;
        return [String(Number(id) - 1), Number(value)];
      }),
    ),
  );
const exportReplay = async (page: Page) => {
  await page.getByRole("button", { name: "기보 보기" }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "JSON 내보내기", exact: true }).click();
  const record = JSON.parse(await readFile((await (await download).path())!, "utf8"));
  await page.getByRole("button", { name: "기보 닫기" }).click();
  return record;
};

/* -------------------------------------------------------------------- setup -------------------------------------------------------------------- */

test("AI 설정: 이름·AI 먼저가 실제 게임·점수판·기보에 반영되고, 설정 변경 후에도 입력값이 유지된다", async ({ page }) => {
  await startAI(page, { algorithm: "Random", name: "요트왕", first: "AI 먼저" });
  // AI holds seat 0 and moves first; the human is seat 1.
  await expect(page.locator('.score-summary [data-seat="0"]')).toContainText("AI · 매우 쉬움");
  await expect(page.locator('.score-summary [data-seat="1"]')).toContainText("요트왕");
  await expect(page.locator(".turn-indicator")).toContainText("나의 차례", { timeout: 20000 });
  await expect(page.locator(".scoreboard .fixed-score")).toHaveCount(1);
  const record = await exportReplay(page);
  expect(record.metadata.players.map((p: { type: string }) => p.type)).toEqual(["ai", "human"]);
  expect(record.metadata.players[1].name).toBe("요트왕");
  await page.getByRole("button", { name: "설정 변경" }).click();
  await page.getByRole("dialog", { name: "설정을 바꿀까요?" }).getByRole("button", { name: "설정 변경" }).click();
  await expect(page).toHaveURL(/#play-setup$/);
  await expect(page.getByLabel("내 이름")).toHaveValue("요트왕");
  await expect(page.getByRole("radiogroup", { name: "선공" }).getByRole("radio", { checked: true })).toHaveCount(1);
  await expect(page.getByRole("radiogroup", { name: "AI 난이도" }).getByRole("radio", { checked: true })).toHaveAttribute("value", "Random");
});

test("AI 설정: 미구현 13칸 규칙은 선택할 수 없고 고급 설정의 연구용 알고리즘은 난이도와 분리된다", async ({ page }) => {
  await page.goto("#play-setup");
  const rules = page.getByRole("group", { name: "게임 규칙" });
  await expect(rules.getByRole("radio")).toHaveCount(2);
  await expect(rules.getByRole("radio").nth(0)).toBeChecked();
  await expect(rules.getByRole("radio").nth(1)).toBeDisabled();
  await expect(rules).toContainText("준비 중");
  await page.getByText("고급 설정", { exact: true }).click();
  await expect(page.getByRole("radiogroup", { name: "AI 행동 속도" })).toBeVisible();
  await page.getByText("연구용 알고리즘 직접 선택").click();
  await expect(page.getByRole("radiogroup", { name: "AI 난이도" }).getByRole("radio").first()).toBeDisabled();
  await page.getByRole("button", { name: "게임 시작" }).click();
  await expect(page.locator(".score-summary")).toContainText("AI · DP Expert");
});

test("사람 설정: 인원·이름(빈 값·중복 처리)·무작위 순서가 실제 게임·기보와 일치한다", async ({ page }) => {
  await startLocal(page, { count: 3, names: ["민수", "", "민수"], order: "무작위" });
  const chips = await page.locator(".multi-player-chip span").allTextContents();
  expect([...chips].sort()).toEqual(["민수", "민수 (2)", "플레이어 2"].sort());
  await expect(page.locator(".turn-indicator")).toContainText(chips[0] + "의 차례");
  await page.getByRole("button", { name: "주사위 굴리기" }).click();
  await scoreCategory(page);
  await expect(page.locator(".turn-indicator")).toContainText(chips[1] + "의 차례");
  const record = await exportReplay(page);
  expect(record.metadata.players.map((p: { name: string }) => p.name)).toEqual(chips);
});

test("사람 설정: 뒤로 가기와 인원 변경 후에도 입력값이 유지되고 5~50명은 고급 설정에서 고른다", async ({ page }) => {
  await page.goto("#pvp-setup");
  await page.getByRole("radiogroup", { name: "참가 인원" }).getByText("4명", { exact: true }).click();
  await page.getByLabel("플레이어 4 이름").fill("넷째");
  await page.getByRole("radiogroup", { name: "참가 인원" }).getByText("2명", { exact: true }).click();
  await expect(page.getByLabel("플레이어 4 이름")).toHaveCount(0);
  await page.getByRole("button", { name: "뒤로" }).click();
  await expect(page).toHaveURL(/#offline$/);
  await page.getByRole("button", { name: /사람 vs 사람/ }).click();
  await page.getByRole("radiogroup", { name: "참가 인원" }).getByText("4명", { exact: true }).click();
  await expect(page.getByLabel("플레이어 4 이름")).toHaveValue("넷째");
  await page.locator(".setup-advanced summary").click();
  await page.getByLabel("참가 인원 직접 입력").fill("12");
  await expect(page.locator(".name-scroll input")).toHaveCount(12);
  await page.getByRole("button", { name: "게임 시작" }).click();
  await expect(page.locator(".multi-player-chip")).toHaveCount(12);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("게임 중 홈·재대결은 확인을 거치며 취소하면 경기가 그대로 남는다", async ({ page }) => {
  await page.goto("#pvp");
  await page.getByRole("button", { name: "주사위 굴리기" }).click();
  await scoreCategory(page);
  await page.getByRole("button", { name: "홈으로" }).click();
  const leave = page.getByRole("dialog", { name: "게임을 나갈까요?" });
  await expect(leave).toBeVisible();
  await leave.getByRole("button", { name: "계속 플레이" }).click();
  await expect(page.locator(".scoreboard .fixed-score")).toHaveCount(1);
  await page.getByRole("button", { name: "재대결", exact: true }).click();
  await page.getByRole("dialog", { name: "새 경기를 시작할까요?" }).getByRole("button", { name: "계속 플레이" }).click();
  await expect(page.locator(".scoreboard .fixed-score")).toHaveCount(1);
  await page.getByRole("button", { name: "홈으로" }).click();
  await leave.getByRole("button", { name: "나가기" }).click();
  await expect(page.locator(".lobby")).toBeVisible();
});

test("기존 직접 주소 #play / #pvp 는 저장된 설정으로 바로 게임을 연다", async ({ page }) => {
  await startLocal(page, { count: 3 });
  await page.goto("#home");
  await page.goto("#pvp");
  await expect(page.locator(".multi-player-chip")).toHaveCount(3);
  await page.goto("#play");
  await expect(page.getByRole("button", { name: "주사위 굴리기" })).toBeEnabled();
});

/* ---------------------------------------------------------------------- 3D ---------------------------------------------------------------------- */

for (const quality of ["3d-high", "3d"] as const)
  test(`3D 주사위(${quality}): 실제 3D로 굴러 엔진 결과와 같은 눈에서 멈추고 고정 주사위는 재굴림되지 않는다`, async ({ page }) => {
    await withMotion(page, quality);
    await page.goto("#play");
    // Let the lazily loaded 3D chunk arrive (it is preloaded when idle).
    await expect.poll(() => page.evaluate(() => performance.getEntriesByType("resource").some((r) => /stage-.*\.js|dice3d\/stage/.test(r.name)))).toBe(true);
    await page.getByRole("button", { name: "주사위 굴리기" }).click();
    await expect(page.locator(".dice3d-canvas")).toBeVisible();
    await expect(page.locator(".die-in-3d")).toHaveCount(5);
    await expect(page.locator(".dice-animating")).toHaveCount(0, { timeout: 5000 });
    await expect(page.locator(".dice3d-canvas")).toBeHidden();
    let roll = (await lastRoll(page))!;
    expect(roll.mode).toBe("3d");
    expect(roll.finals).toEqual(roll.targets);
    expect(roll.targets).toEqual(await domFaces(page));
    // Hold two dice, reroll: only the other three are thrown.
    await page.locator(".die-button").nth(0).click();
    await page.locator(".die-button").nth(2).click();
    const held = await page.locator(".die-button").evaluateAll((n) => [n[0].getAttribute("aria-label"), n[2].getAttribute("aria-label")]);
    await page.getByRole("button", { name: "다시 굴리기" }).click();
    await expect(page.locator(".die-in-3d")).toHaveCount(3);
    await expect(page.locator(".dice-animating")).toHaveCount(0, { timeout: 5000 });
    roll = (await lastRoll(page))!;
    expect(Object.keys(roll.targets)).toHaveLength(3);
    expect(roll.finals).toEqual(roll.targets);
    expect(await page.locator(".die-button").evaluateAll((n) => [n[0].getAttribute("aria-label"), n[2].getAttribute("aria-label")])).toEqual(held);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

test("3D 주사위: 굴리는 중 빠른 연속 입력으로 중복 굴림이 생기지 않는다", async ({ page }) => {
  await withMotion(page, "3d");
  await page.goto("#play");
  await expect.poll(() => page.evaluate(() => performance.getEntriesByType("resource").some((r) => /stage-.*\.js|dice3d\/stage/.test(r.name)))).toBe(true);
  const roll = page.getByRole("button", { name: "주사위 굴리기" });
  await roll.dblclick();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("게임 보드")).toContainText("굴림 1 / 3");
  await expect(page.locator(".dice-animating")).toHaveCount(0, { timeout: 5000 });
  await expect(page.getByLabel("게임 보드")).toContainText("굴림 1 / 3");
});

test("WebGL을 쓸 수 없으면 2.5D 연출로 대체되고 3D 품질은 선택할 수 없다", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __YACHTLAB_DISABLE_WEBGL__: boolean }).__YACHTLAB_DISABLE_WEBGL__ = true;
  });
  await withMotion(page, "3d-high");
  await page.goto("#play");
  await page.getByRole("button", { name: "주사위 굴리기" }).click();
  await expect(page.locator(".dice3d-canvas")).toHaveCount(0);
  await expect(page.locator(".dice-animating")).toHaveCount(0, { timeout: 2000 });
  expect((await lastRoll(page))!.mode).toBe("2.5d");
  await page.getByRole("button", { name: "설정", exact: true }).click();
  const quality = page.getByRole("combobox", { name: "주사위 애니메이션 품질" });
  expect(await quality.locator("option").evaluateAll((o) => (o as HTMLOptionElement[]).filter((x) => x.disabled).map((x) => x.value))).toEqual(["3d-high", "3d"]);
  await expect(page.getByRole("dialog", { name: "설정" })).toContainText("3D를 지원하지 않아");
});

test("3D 효과음은 실제 충돌에서 재생되고 개수가 제한된다", async ({ page }) => {
  await withMotion(page, "3d");
  await page.goto("#play");
  await expect.poll(() => page.evaluate(() => performance.getEntriesByType("resource").some((r) => /stage-.*\.js|dice3d\/stage/.test(r.name)))).toBe(true);
  await page.getByRole("button", { name: "주사위 굴리기" }).click();
  await expect(page.locator(".dice-animating")).toHaveCount(0, { timeout: 5000 });
  const log = await page.evaluate(() => (window as unknown as { __yachtlabSound: { log: { name: string; delay: number }[] } }).__yachtlabSound.log.map((e) => ({ ...e })));
  const names = log.map((e) => e.name);
  expect(names[0]).toBe("throw");
  expect(names.at(-1)).toBe("settle");
  const impacts = log.filter((e) => e.name === "impact");
  expect(impacts.length).toBeGreaterThan(0);
  expect(impacts.length).toBeLessThanOrEqual(14);
  expect(impacts.every((e) => e.delay === 0)).toBe(true); // played live at the rendered collision frame
});

/* ------------------------------------------------------------------ home & lab ------------------------------------------------------------------ */

test("홈 주사위 체험: 직접 굴리고 고정할 수 있으며 게임 기록이나 AI와 무관하다", async ({ page }) => {
  await withMotion(page, "3d");
  await page.goto("");
  const tray = page.getByRole("region", { name: "주사위 굴려 보기" });
  await expect(tray.locator(".die-button")).toHaveCount(5);
  await tray.locator(".die-button").first().click();
  await expect(tray.locator(".die-button").first()).toHaveAttribute("aria-pressed", "true");
  const kept = await tray.locator(".die-button").first().getAttribute("aria-label");
  await tray.getByRole("button", { name: "굴려 보기" }).click();
  await expect(tray.locator(".dice-animating")).toHaveCount(4);
  await expect(tray.locator(".dice-animating")).toHaveCount(0, { timeout: 5000 });
  await expect(tray.locator(".die-button").first()).toHaveAttribute("aria-label", kept!);
  const roll = (await lastRoll(page))!;
  expect(Object.keys(roll.targets)).toHaveLength(4);
  const stored = await page.evaluate(() => Object.keys(localStorage).filter((k) => /replay|record/i.test(k)));
  expect(stored).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("주사위 실험실: 지정한 눈으로 3D와 2.5D를 비교하고 물리 일괄 검증이 모두 일치한다", async ({ page }) => {
  test.setTimeout(90000);
  await withMotion(page);
  await page.goto("#dice-lab");
  for (let i = 1; i <= 5; i++) await page.getByLabel(`주사위 ${i} 결과`).selectOption(String(i === 5 ? 6 : i));
  await page.getByLabel("연출 방식").selectOption("3d-high");
  await expect.poll(() => page.evaluate(() => performance.getEntriesByType("resource").some((r) => /stage-.*\.js|dice3d\/stage/.test(r.name)))).toBe(true);
  await page.getByRole("button", { name: "굴리기" }).click();
  await expect(page.getByTestId("dice-lab-last")).toContainText("3d", { timeout: 6000 });
  await expect(page.getByTestId("dice-lab-last")).toContainText("예");
  expect(await domFaces(page)).toEqual({ 0: 1, 1: 2, 2: 3, 3: 4, 4: 6 });
  await page.getByLabel("연출 방식").selectOption("2.5d");
  await page.getByRole("button", { name: "굴리기" }).click();
  await expect(page.getByTestId("dice-lab-last")).toContainText("2.5d", { timeout: 4000 });
  await page.getByRole("button", { name: /300회 검증/ }).click();
  await expect(page.getByTestId("dice-lab-batch")).toContainText("300/300", { timeout: 60000 });
  const text = await page.getByTestId("dice-lab-batch").innerText();
  expect(text).toMatch(/최종 눈 일치\s*300\/300/);
});

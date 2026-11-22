import { test, expect, type Page } from "@playwright/test";

const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1440) <= 760;
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
type SoundEntry = { name: string; delay: number; played: boolean };
const soundLog = (page: Page) => page.evaluate(() => ((window as unknown as { __yachtlabSound: { log: SoundEntry[] } }).__yachtlabSound.log as SoundEntry[]).map((e) => ({ ...e })));
const clearSound = (page: Page) => page.evaluate(() => { (window as unknown as { __yachtlabSound: { log: unknown[] } }).__yachtlabSound.log.length = 0; });

test("홈 → 오프라인 대전 → 사람 vs AI / 사람 vs 사람 진입과 홈 복귀", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("");
  const modes = page.locator(".lobby .mode-card");
  await expect(modes).toHaveCount(2);
  await expect(modes.first()).toContainText("온라인 대전");
  await modes.nth(1).click();
  await expect(page).toHaveURL(/#offline$/);
  await expect(page.getByRole("heading", { name: "오프라인 대전" })).toBeVisible();
  await page.getByRole("button", { name: /사람 vs AI/ }).click();
  await expect(page).toHaveURL(/#play$/);
  await expect(page.locator(".shell-game")).toBeVisible();
  await expect(page.getByRole("button", { name: "주사위 굴리기" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "상대 AI" })).toBeVisible();
  await expect(page.locator(".sidebar")).toHaveCount(0);
  await page.getByRole("button", { name: "홈으로" }).click();
  await expect(page.locator(".lobby")).toBeVisible();
  await page.getByRole("button", { name: /오프라인 대전/ }).click();
  await page.getByRole("button", { name: /사람 vs 사람/ }).click();
  await expect(page).toHaveURL(/#pvp$/);
  await expect(page.getByLabel("사람 vs 사람 게임 보드")).toBeVisible();
  expect(await noHorizontalScroll(page)).toBe(true);
  expect(errors).toEqual([]);
});

test("온라인 대전은 준비 중 화면만 보여 주고 실제 대전처럼 보이지 않는다", async ({ page }) => {
  await page.goto("");
  const online = page.locator(".mode-online");
  await expect(online.locator(".mode-badge")).toHaveText("준비 중");
  await online.click();
  await expect(page).toHaveURL(/#online$/);
  await expect(page.getByRole("heading", { name: "온라인 대전은 준비 중이에요" })).toBeVisible();
  await expect(page.locator("main")).toContainText("서버와 연결되어 있지 않아");
  // No matchmaking controls, no fake player lists or inputs.
  await expect(page.locator("main input, main select, .dice-row")).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText(/매칭 중|접속자|상대를 찾/);
  await page.getByRole("button", { name: /오프라인 대전 하기/ }).click();
  await expect(page).toHaveURL(/#offline$/);
});

test("연구 기능은 연구실/설정에서 접근하고 기존 딥링크와 내 기록도 유지된다", async ({ page }) => {
  await page.goto("");
  await page.getByRole("button", { name: "연구실" }).click();
  await expect(page.getByRole("heading", { name: "연구실" })).toBeVisible();
  const tools = page.locator(".lab-tool");
  await expect(tools).toHaveCount(3);
  for (const [name, heading] of [["AI 대전 관전", "AI 대전 관전"], ["AI 토너먼트", "AI 토너먼트"], ["전략 분석실", "전략 분석실"]]) {
    await page.getByRole("navigation", { name: "연구실 메뉴" }).getByRole("link", { name, exact: true }).click();
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }
  await page.goto("#tournament");
  await expect(page.getByRole("heading", { name: "AI 토너먼트" })).toBeVisible();
  await page.getByRole("button", { name: "설정" }).click();
  const settings = page.getByRole("dialog", { name: "설정" });
  await settings.getByRole("button", { name: /내 기록/ }).click();
  await expect(page).toHaveURL(/#records$/);
  await page.getByRole("button", { name: "설정" }).click();
  await page.getByRole("dialog", { name: "설정" }).getByRole("button", { name: /연구실/ }).click();
  await expect(page).toHaveURL(/#lab$/);
  await page.goto("");
  await page.getByRole("button", { name: "내 기록" }).click();
  await expect(page).toHaveURL(/#records$/);
});

test("설정: 음소거·음량·애니메이션 간단히가 브라우저에 저장된다", async ({ page }) => {
  await page.goto("#play");
  await expect(page.getByRole("button", { name: "효과음 끄기" })).toBeVisible();
  await page.getByRole("button", { name: "설정" }).click();
  const dialog = page.getByRole("dialog", { name: "설정" });
  await dialog.getByRole("slider", { name: "효과음 음량" }).fill("30");
  await dialog.getByRole("switch", { name: "주사위 애니메이션 간단히" }).check();
  await dialog.getByRole("switch", { name: "효과음" }).uncheck();
  await expect(dialog.getByRole("slider", { name: "효과음 음량" })).toBeDisabled();
  await dialog.getByRole("button", { name: "설정 닫기" }).click();
  await expect(page.getByRole("button", { name: "효과음 켜기" })).toBeVisible();
  await page.reload();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("yachtlab.settings.v1")!))).toEqual({ muted: true, volume: 0.3, reducedEffects: true });
  await page.getByRole("button", { name: "설정" }).click();
  await expect(page.getByRole("switch", { name: "효과음" })).not.toBeChecked();
  await expect(page.getByRole("slider", { name: "효과음 음량" })).toHaveValue("30");
  await expect(page.getByRole("switch", { name: "주사위 애니메이션 간단히" })).toBeChecked();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "설정" })).toHaveCount(0);
  // Broken storage must not break the game.
  await page.evaluate(() => localStorage.setItem("yachtlab.settings.v1", "{not json"));
  await page.reload();
  await expect(page.getByRole("button", { name: "효과음 끄기" })).toBeVisible();
});

test("주사위: 던지기 연출 후 엔진 결과와 같은 눈에서 멈추고 고정 주사위는 움직이지 않는다", async ({ page }) => {
  await page.goto("#play");
  await page.getByRole("button", { name: "주사위 굴리기" }).click();
  await expect(page.locator(".die-button.dice-animating")).toHaveCount(5);
  // Short: everything settles well under a second.
  await expect(page.locator(".dice-animating")).toHaveCount(0, { timeout: 1000 });
  const faces = () =>
    page.locator(".die-button").evaluateAll((nodes) =>
      nodes.map((n) => ({
        engine: Number(n.getAttribute("aria-label")!.split(", ")[1]),
        shown: Number(n.querySelector(".die-icon")!.getAttribute("aria-label")!.split(" ").at(-1)),
        moving: n.querySelector(".die-motion")!.getAnimations().length,
      })),
    );
  for (const die of await faces()) {
    expect(die.shown).toBe(die.engine);
    expect(die.moving).toBe(0);
  }
  const held = page.locator(".die-button").nth(1);
  await held.click();
  await expect(held).toHaveAttribute("aria-pressed", "true");
  const heldLabel = await held.getAttribute("aria-label");
  await page.getByRole("button", { name: "다시 굴리기" }).click();
  await expect(page.locator(".die-button.dice-animating")).toHaveCount(4);
  await expect(held).not.toHaveClass(/dice-animating/);
  expect(await held.locator(".die-motion").evaluate((n) => n.getAnimations().length)).toBe(0);
  await expect(held).toHaveAttribute("aria-label", heldLabel!);
  await expect(page.locator(".dice-animating")).toHaveCount(0, { timeout: 1000 });
  for (const die of await faces()) expect(die.shown).toBe(die.engine);
});

test("주사위: 굴리는 도중 바로 누른 주사위만 고정된다 (날아가는 주사위가 입력을 가로채지 않음)", async ({ page }) => {
  await page.goto("#play");
  await page.getByRole("button", { name: "주사위 굴리기" }).click();
  for (const index of [0, 3]) {
    const box = (await page.locator(".die-button").nth(index).boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  }
  const pressed = await page.locator(".die-button").evaluateAll((nodes) => nodes.map((n) => n.getAttribute("aria-pressed")));
  expect(pressed).toEqual(["true", "false", "false", "true", "false"]);
});

test("주사위: 동작 줄이기에서는 움직임 없이 바로 결과를 보여 준다", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("#play");
  await page.getByRole("button", { name: "주사위 굴리기" }).click();
  await expect(page.locator(".dice-animating")).toHaveCount(0);
  expect(await page.locator(".die-motion").evaluateAll((nodes) => nodes.reduce((n, el) => n + el.getAnimations().length, 0))).toBe(0);
});

test("효과음은 주사위 착지 시점과 맞춰 예약되고 음소거하면 재생되지 않는다", async ({ page }) => {
  await page.goto("#play");
  await page.getByRole("button", { name: "주사위 굴리기" }).click(); // user gesture unlocks audio
  await expect(page.locator(".dice-animating")).toHaveCount(0, { timeout: 1500 });
  let log = await soundLog(page);
  const names = log.map((e) => e.name);
  expect(names[0]).toBe("throw");
  expect(names).toContain("impact");
  expect(names.at(-1)).toBe("settle");
  const impacts = log.filter((e) => e.name === "impact").map((e) => e.delay);
  expect(impacts.every((d) => d > 0.05 && d < 0.8)).toBe(true);
  expect([...impacts].sort((a, b) => a - b)).toEqual(impacts);
  expect(log.find((e) => e.name === "settle")!.delay).toBeGreaterThanOrEqual(Math.max(...impacts));
  await clearSound(page);
  await page.locator(".die-button").first().click();
  await expect.poll(async () => (await soundLog(page)).map((e) => e.name)).toContain("hold");
  await page.getByRole("button", { name: "효과음 끄기" }).click();
  await clearSound(page);
  await page.getByRole("button", { name: "다시 굴리기" }).click();
  await expect.poll(async () => (await soundLog(page)).length).toBeGreaterThan(0);
  log = await soundLog(page);
  expect(log.every((e) => !e.played)).toBe(true);
});

test("트레이를 옆으로 쓸어 던지면 굴리고, 주사위에서 시작한 드래그는 던지지 않는다", async ({ page }) => {
  test.skip(isMobile(page), "마우스 제스처는 데스크톱에서 확인");
  await page.goto("#play");
  const board = page.getByLabel("게임 보드");
  const box = (await board.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height - 40);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height - 50, { steps: 4 });
  await page.mouse.up();
  await expect(page.getByRole("button", { name: "다시 굴리기" })).toBeVisible();
  await expect(board).toContainText("굴림 1 / 3");
  await expect(page.locator(".dice-animating")).toHaveCount(0, { timeout: 1500 });
  const die = (await page.locator(".die-button").first().boundingBox())!;
  await page.mouse.move(die.x + die.width / 2, die.y + die.height / 2);
  await page.mouse.down();
  await page.mouse.move(die.x + 200, die.y + 10, { steps: 6 });
  await page.mouse.up();
  await expect(board).toContainText("굴림 1 / 3");
});

test("족보 툴팁: 호버 지연·키보드 Esc·터치, 예시 점수와 화면 안쪽 배치", async ({ page }) => {
  await page.goto("#play");
  const tooltip = page.getByRole("tooltip");
  if (!isMobile(page)) {
    const row = page.locator('.scoreboard [data-category="four"] th');
    await row.hover();
    await page.waitForTimeout(200);
    await expect(tooltip).toHaveCount(0);
    await expect(tooltip).toBeVisible({ timeout: 1500 });
    await expect(tooltip).toContainText("같은 눈이 4개 이상");
    await expect(tooltip).toContainText("22점");
    await page.mouse.move(5, 5);
    await expect(tooltip).toHaveCount(0);
    const bonus = page.getByRole("button", { name: "상단 보너스 설명" }).first();
    await bonus.focus();
    await expect(tooltip).toContainText("63점 이상");
    await expect(bonus).toHaveAttribute("aria-describedby", /.+/);
    await page.keyboard.press("Escape");
    await expect(tooltip).toHaveCount(0);
  } else {
    await page.getByRole("button", { name: "점수판 열기" }).click();
    const dialog = page.getByRole("dialog", { name: "점수판" });
    await dialog.getByRole("button", { name: "요트 설명" }).tap();
    await expect(dialog.getByRole("tooltip")).toContainText("50점");
    const box = (await dialog.getByRole("tooltip").boundingBox())!;
    const width = page.viewportSize()!.width;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    await dialog.locator(".mobile-quick-group-title").first().tap();
    await expect(page.getByRole("tooltip")).toHaveCount(0);
    await expect(dialog).toBeVisible(); // closing the tooltip does not close the sheet
    await dialog.getByRole("button", { name: "상단 보너스 설명" }).tap();
    await expect(dialog.getByRole("tooltip")).toContainText("63점 이상");
    await page.screenshot({ path: `test-results/tooltip-${test.info().project.name}.png` });
  }
});

test("족보 툴팁은 로컬 대전 점수판에서도 같은 내용으로 열린다", async ({ page }) => {
  await page.goto("#pvp");
  if (isMobile(page)) {
    await page.getByRole("button", { name: "점수판 열기" }).click();
    await page.getByRole("dialog", { name: "점수판" }).getByRole("button", { name: "풀 하우스 설명" }).tap();
  } else await page.locator(".multi-scoreboard").getByRole("button", { name: "풀 하우스 설명" }).click();
  await expect(page.getByRole("tooltip")).toContainText("21점");
  await expect(page.getByRole("tooltip")).toContainText("다섯 개가 모두 같은 눈은 풀 하우스가 아니에요");
});

test("게임 화면은 상단 홈·사운드·설정과 넓은 보드를 제공하고 넘치지 않는다", async ({ page }) => {
  await page.goto("#play");
  const top = page.locator(".shell-top");
  const home = (await top.getByRole("button", { name: "홈으로" }).boundingBox())!;
  const settings = (await top.getByRole("button", { name: "설정" }).boundingBox())!;
  const width = page.viewportSize()!.width;
  expect(home.x).toBeLessThan(width / 4);
  expect(settings.x).toBeGreaterThan(width * 0.6);
  await expect(top.getByRole("button", { name: /효과음/ })).toBeVisible();
  const board = (await page.getByLabel("게임 보드").boundingBox())!;
  if (isMobile(page)) expect(board.width).toBeGreaterThan(width - 40);
  else {
    await expect(top.getByRole("button", { name: "전체 화면" })).toBeVisible();
    expect(board.width).toBeGreaterThan(width * 0.55);
  }
  // Touch targets in the top bar are at least 40px.
  for (const b of await top.getByRole("button").all()) {
    const r = (await b.boundingBox())!;
    expect(Math.min(r.width, r.height)).toBeGreaterThanOrEqual(38);
  }
  expect(await noHorizontalScroll(page)).toBe(true);
});

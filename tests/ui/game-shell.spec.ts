import { test, expect, type Page } from "@playwright/test";
import { SEEDS, fixSeed, withMotion } from "./helpers";

const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1440) <= 760;
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
type SoundEntry = { name: string; delay: number; played: boolean; at: number };
const soundLog = (page: Page) => page.evaluate(() => ((window as unknown as { __yachtlabSound: { log: SoundEntry[] } }).__yachtlabSound.log as SoundEntry[]).map((e) => ({ ...e })));
const clearSound = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as { __yachtlabSound: { log: unknown[] } }).__yachtlabSound.log.length = 0;
  });

test("사이드바는 닫기 전환을 마친 뒤 포커스를 되돌리고 현재 페이지를 표시한다", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("#offline");
  const trigger = page.getByRole("button", { name: "메뉴", exact: true });
  const menu = page.getByRole("dialog", { name: "메뉴" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(menu.getByRole("button", { name: "메뉴 닫기" })).toBeFocused();
  await expect(menu.getByRole("button", { name: "오프라인 대전" })).toHaveAttribute("aria-current", "page");
  expect(await menu.evaluate((el) => [getComputedStyle(el).animationDuration, getComputedStyle(el, "::backdrop").animationDuration])).toEqual(["0.24s", "0.24s"]);
  await page.keyboard.press("Escape");
  expect(await menu.evaluate((el: HTMLDialogElement) => [el.open, el.dataset.phase])).toEqual([true, "closing"]);
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();

  await trigger.click();
  await page.mouse.click(page.viewportSize()!.width - 4, 120);
  await expect(menu).toHaveCount(0);

  await trigger.click();
  const heading = menu.locator(".mobile-nav-heading");
  await heading.dispatchEvent("pointerdown", { pointerType: "touch", pointerId: 7, clientX: 150, clientY: 32 });
  await heading.dispatchEvent("pointerup", { pointerType: "touch", pointerId: 7, clientX: 75, clientY: 34 });
  await expect(menu).toHaveCount(0);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await trigger.click();
  expect(await menu.evaluate((el) => Number.parseFloat(getComputedStyle(el).animationDuration))).toBeLessThanOrEqual(0.001);
  await menu.getByRole("button", { name: "메뉴 닫기" }).click();
  await expect(menu).toHaveCount(0);
});

test("홈 → 오프라인 → 상세 설정 → 사람 vs AI / 사람 vs 사람 진입과 홈 복귀", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("");
  const modes = page.locator(".lobby .mode-card");
  await expect(modes).toHaveCount(2);
  // Online is the first (main) card; offline play is the second.
  await expect(modes.first()).toContainText("온라인 대전");
  await expect(modes.nth(1)).toContainText("오프라인 대전");
  await modes.nth(1).click();
  await expect(page).toHaveURL(/#offline$/);
  await expect(page.getByRole("heading", { name: "오프라인 대전" })).toBeVisible();
  await page.getByRole("button", { name: /사람 vs AI/ }).click();
  await expect(page).toHaveURL(/#play-setup$/);
  await expect(page.getByRole("heading", { name: "사람 vs AI" })).toBeVisible();
  await page.getByRole("button", { name: "게임 시작" }).click();
  await expect(page).toHaveURL(/#play$/);
  await expect(page.locator(".shell-game")).toBeVisible();
  await expect(page.getByRole("button", { name: "주사위 굴리기" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "상대 AI" })).toHaveCount(0);
  await expect(page.locator(".sidebar")).toHaveCount(0);
  await page.getByRole("button", { name: "홈으로" }).click();
  await expect(page.locator(".lobby")).toBeVisible();
  await page.getByRole("button", { name: /오프라인 대전/ }).click();
  await page.getByRole("button", { name: /사람 vs 사람/ }).click();
  await expect(page).toHaveURL(/#pvp-setup$/);
  await page.getByRole("button", { name: "게임 시작" }).click();
  await expect(page).toHaveURL(/#pvp$/);
  await expect(page.getByLabel("사람 vs 사람 게임 보드")).toBeVisible();
  expect(await noHorizontalScroll(page)).toBe(true);
  expect(errors).toEqual([]);
});

test("서버 주소가 없는 빌드에서 온라인 대전은 연결 안내만 보여 주고 실제 대전처럼 보이지 않는다", async ({ page }) => {
  await page.goto("");
  const online = page.locator(".mode-online");
  await expect(online.locator(".mode-badge")).toHaveCount(0);
  await expect(online).not.toContainText("준비 중");
  await online.click();
  await expect(page).toHaveURL(/#online$/);
  await expect(page.getByRole("heading", { name: "온라인 서버에 연결되어 있지 않아요" })).toBeVisible();
  await expect(page.locator("main")).toContainText("서버 주소가 설정되어 있지 않아");
  // No matchmaking controls, no fake player lists or inputs.
  await expect(page.locator("main input, main select, .dice-row")).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText(/매칭 중|접속자|상대를 찾/);
  await page.getByRole("button", { name: /오프라인 대전 하기/ }).click();
  await expect(page).toHaveURL(/#offline$/);
});

test("일반 메뉴와 설정에서 연구실을 숨기고 기존 딥링크와 내 기록을 유지한다", async ({ page }) => {
  await page.goto("");
  await page.goto("#lab");
  await expect(page.getByRole("heading", { name: "연구실" })).toBeVisible();
  await expect(page.locator(".lab-tool")).toHaveCount(5);
  for (const name of ["AI 대전 관전", "AI 토너먼트", "전략 분석실", "주사위 실험실", "경제 연구실"]) {
    await page.getByRole("navigation", { name: "연구실 메뉴" }).getByRole("link", { name, exact: true }).click();
    await expect(page.getByRole("heading", { name })).toBeVisible();
  }
  await page.goto("#tournament");
  await expect(page.getByRole("heading", { name: "AI 토너먼트" })).toBeVisible();
  await page.getByRole("button", { name: "설정", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "설정" });
  await expect(settings.getByRole("button", { name: /연구실|튜토리얼|내 기록/ })).toHaveCount(0);
  await settings.getByRole("button", { name: "설정 닫기" }).click();
  await page.getByRole("button", { name: "메뉴", exact: true }).click();
  const menu = page.getByRole("dialog", { name: "메뉴" });
  await expect(menu.getByRole("button", { name: /연구실|튜토리얼|프로필/ })).toHaveCount(0);
  await menu.getByRole("button", { name: "내 기록" }).click();
  await expect(page).toHaveURL(/#records$/);
  await page.goto("#play-setup");
  await page.getByText("고급 설정", { exact: true }).click();
  await expect(page.getByText("연구용 알고리즘 직접 선택")).toHaveCount(0);
});

test("설정: 음소거·음량·애니메이션 품질·모션 간단히가 브라우저에 저장되고 게임 중에는 환경설정만 보인다", async ({ page }) => {
  await page.goto("#play");
  await expect(page.getByRole("button", { name: "효과음 끄기" })).toHaveCount(0);
  await page.getByRole("button", { name: "설정", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "설정" });
  // In a game only presentation settings are offered (rules/difficulty live in the setup screen).
  await expect(dialog.getByRole("button", { name: /내 기록|연구실/ })).toHaveCount(0);
  await expect(dialog).toContainText("설정 변경");
  await dialog.getByRole("slider", { name: "효과음 음량" }).fill("30");
  await dialog.getByRole("combobox", { name: "주사위 애니메이션 품질" }).selectOption("2.5d");
  await dialog.getByRole("switch", { name: "모션 간단히" }).check();
  await dialog.getByRole("switch", { name: "효과음" }).uncheck();
  await expect(dialog.getByRole("slider", { name: "효과음 음량" })).toBeDisabled();
  await dialog.getByRole("button", { name: "설정 닫기" }).click();
  await page.getByRole("button", { name: "설정", exact: true }).click();
  await expect(page.getByRole("switch", { name: "효과음", exact: true })).not.toBeChecked();
  await page.getByRole("button", { name: "설정 닫기" }).click();
  await page.reload();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("yachtlab.settings.v1")!))).toEqual({ muted: true, volume: 0.3, reducedEffects: true, diceQuality: "2.5d", opponentFx: true });
  await page.getByRole("button", { name: "설정", exact: true }).click();
  await expect(page.getByRole("switch", { name: "효과음" })).not.toBeChecked();
  await expect(page.getByRole("slider", { name: "효과음 음량" })).toHaveValue("30");
  await expect(page.getByRole("switch", { name: "모션 간단히" })).toBeChecked();
  await expect(page.getByRole("combobox", { name: "주사위 애니메이션 품질" })).toHaveValue("2.5d");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "설정" })).toHaveCount(0);
  // Broken storage must not break the game.
  await page.evaluate(() => localStorage.setItem("yachtlab.settings.v1", "{not json"));
  await page.reload();
  await expect(page.getByRole("button", { name: "효과음 끄기" })).toHaveCount(0);
});

test("2.5D 주사위: 연출 후 엔진 결과와 같은 눈에서 멈추고 고정 주사위는 움직이지 않는다", async ({ page }) => {
  await withMotion(page, "2.5d");
  await page.goto("#play");
  await page.getByRole("button", { name: "주사위 굴리기" }).click();
  await expect(page.locator(".die-button.dice-animating")).toHaveCount(5);
  await expect(page.locator(".dice-animating")).toHaveCount(0, { timeout: 1500 });
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
  await expect(page.locator(".dice-animating")).toHaveCount(0, { timeout: 1500 });
  for (const die of await faces()) expect(die.shown).toBe(die.engine);
});

test("주사위: 굴리는 중에는 입력을 받지 않아 다른 주사위로 잘못 전달되지 않고, 멈춘 뒤 누른 주사위만 고정된다", async ({ page }) => {
  await withMotion(page, "2.5d");
  await page.goto("#play");
  // Keep the roll in progress while both native clicks travel through the browser.
  const start = new Date();
  await page.clock.install({ time: start });
  await page.clock.pauseAt(new Date(start.getTime() + 1000));
  await page.getByRole("button", { name: "주사위 굴리기" }).click();
  await expect(page.locator(".die-button").first()).toBeDisabled();
  await expect(page.getByRole("button", { name: "다시 굴리기" })).toBeDisabled();
  for (const index of [0, 3]) {
    const box = (await page.locator(".die-button").nth(index).boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  }
  const pressed = () => page.locator(".die-button").evaluateAll((nodes) => nodes.map((n) => n.getAttribute("aria-pressed")));
  expect(await pressed()).toEqual(["false", "false", "false", "false", "false"]);
  await page.clock.runFor(1500);
  await page.clock.resume();
  await expect(page.locator(".dice-animating")).toHaveCount(0);
  await page.locator(".die-button").nth(3).click();
  expect(await pressed()).toEqual(["false", "false", "false", "true", "false"]);
});

test("주사위: 동작 줄이기에서는 움직임 없이 바로 결과를 보여 준다", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("#play");
  await page.getByRole("button", { name: "주사위 굴리기" }).click();
  await expect(page.locator(".dice-animating")).toHaveCount(0);
  await expect(page.locator(".dice3d-canvas, .dice-table-canvas")).toHaveCount(0);
  expect(await page.locator(".die-motion").evaluateAll((nodes) => nodes.reduce((n, el) => n + el.getAnimations().length, 0))).toBe(0);
});

test("효과음은 2.5D 착지 시점과 맞춰 예약되고 음소거하면 재생되지 않는다", async ({ page }) => {
  await withMotion(page, "2.5d");
  // A fixed first roll without a combination: a random roll is a large straight or a yacht about
  // 3% of the time, and those (correctly) add their own moment sound after the dice settle.
  await fixSeed(page, SEEDS.none);
  await page.goto("#play");
  await page.getByRole("button", { name: "주사위 굴리기" }).click(); // user gesture unlocks audio
  await expect(page.locator(".dice-animating")).toHaveCount(0, { timeout: 1500 });
  let log = await soundLog(page);
  const names = log.map((e) => e.name);
  expect(names[0]).toBe("throw");
  expect(names).toContain("impact");
  expect(names.at(-1)).toBe("settle");
  expect(names).not.toContain("straightHit");
  const impacts = log.filter((e) => e.name === "impact").map((e) => e.delay);
  expect(impacts.every((d) => d > 0.05 && d < 0.8)).toBe(true);
  expect([...impacts].sort((a, b) => a - b)).toEqual(impacts);
  expect(log.find((e) => e.name === "settle")!.delay).toBeGreaterThanOrEqual(Math.max(...impacts));
  await clearSound(page);
  await page.locator(".die-button").first().click();
  await expect.poll(async () => (await soundLog(page)).map((e) => e.name)).toContain("hold");
  await page.getByRole("button", { name: "설정", exact: true }).click();
  await page.getByRole("switch", { name: "효과음", exact: true }).uncheck();
  await page.getByRole("button", { name: "설정 닫기" }).click();
  await clearSound(page);
  await page.getByRole("button", { name: "다시 굴리기" }).click();
  await expect.poll(async () => (await soundLog(page)).length).toBeGreaterThan(0);
  log = await soundLog(page);
  expect(log.every((e) => !e.played)).toBe(true);
});

test("2.5D 효과음은 던지기 → 충돌 → 착지 → 라지 스트레이트 순서로 재생되고 음소거를 따른다", async ({ page }) => {
  await fixSeed(page, SEEDS.large);
  await withMotion(page, "2.5d");
  await page.goto("#play");
  const roll = page.getByRole("button", { name: "주사위 굴리기" });
  const flash = page.locator(".straight-flash");
  await roll.click(); // user gesture unlocks audio
  await expect(flash).toBeVisible();

  const log = await soundLog(page);
  const impacts = log.filter((entry) => entry.name === "impact").map((entry) => entry.delay);
  expect(impacts.length).toBeGreaterThan(0);
  expect(log.map((entry) => entry.name)).toEqual(["throw", ...impacts.map(() => "impact"), "settle", "straightHit"]);
  expect(impacts.every((delay) => delay > 0.05 && delay < 0.8)).toBe(true);
  expect([...impacts].sort((a, b) => a - b)).toEqual(impacts);
  const settle = log.at(-2)!;
  const straight = log.at(-1)!;
  expect(settle.delay).toBeGreaterThanOrEqual(Math.max(...impacts));
  expect(straight.at).toBeGreaterThanOrEqual(settle.at + settle.delay * 1000);
  expect(straight.played).toBe(true);

  await clearSound(page);
  await page.locator(".die-button").first().click();
  await expect.poll(async () => (await soundLog(page)).map((entry) => entry.name)).toContain("hold");

  await page.getByRole("button", { name: "설정", exact: true }).click();
  await page.getByRole("switch", { name: "효과음", exact: true }).uncheck();
  await page.getByRole("button", { name: "설정 닫기" }).click();
  await clearSound(page);
  const reroll = page.getByRole("button", { name: "다시 굴리기" });
  await reroll.click();
  await expect(reroll).toBeEnabled();
  const mutedReroll = await soundLog(page);
  expect(mutedReroll.map((entry) => entry.name)).toEqual(expect.arrayContaining(["throw", "impact", "settle"]));
  expect(mutedReroll.every((entry) => !entry.played)).toBe(true);

  // Reproduce the same straight after a reload with the persisted mute setting.
  await page.reload();
  await roll.click();
  await expect(flash).toBeVisible();
  const mutedStraight = await soundLog(page);
  const mutedNames = mutedStraight.map((entry) => entry.name);
  expect(mutedNames).toContain("impact");
  expect(mutedNames).toEqual(["throw", ...mutedNames.filter((name) => name === "impact"), "settle", "straightHit"]);
  expect(mutedStraight.every((entry) => !entry.played)).toBe(true);
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
  const die = (await page.locator(".die-button").first().boundingBox())!;
  await page.mouse.move(die.x + die.width / 2, die.y + die.height / 2);
  await page.mouse.down();
  await page.mouse.move(die.x + 200, die.y + 10, { steps: 6 });
  await page.mouse.up();
  await expect(board).toContainText("굴림 1 / 3");
});

test("족보 설명: PC는 이름에 호버, 키보드 포커스·Esc, 모바일은 연한 아이콘 터치(점수 기록과 분리)", async ({ page }) => {
  await page.goto("#play");
  const tooltip = page.getByRole("tooltip");
  if (!isMobile(page)) {
    const help = page.locator('.scoreboard [data-category="four"] .category-help');
    expect(await help.evaluate((n) => getComputedStyle(n).opacity)).toBe("0"); // no repeated icons for mouse users
    await page.locator('.scoreboard [data-category="four"] .category-cell').hover();
    await page.waitForTimeout(200);
    await expect(tooltip).toHaveCount(0);
    await expect(tooltip).toBeVisible({ timeout: 1500 });
    await expect(tooltip).toContainText("같은 눈이 4개 이상");
    await expect(tooltip).toContainText("22점");
    await page.mouse.move(5, 5);
    await expect(tooltip).toHaveCount(0);
    await page.keyboard.press("Tab"); // keyboard mode for :focus-visible
    const bonus = page.getByRole("button", { name: "상단 보너스 설명" }).first();
    await bonus.focus();
    await expect(tooltip).toContainText("63점 이상");
    await expect(bonus).toHaveAttribute("aria-describedby", /.+/);
    await page.keyboard.press("Escape");
    await expect(tooltip).toHaveCount(0);
  } else {
    await page.getByRole("button", { name: "주사위 굴리기" }).click();
    await page.getByRole("button", { name: "점수판 열기" }).click();
    const dialog = page.getByRole("dialog", { name: "점수판" });
    const help = dialog.getByRole("button", { name: "요트 설명" });
    expect(await help.evaluate((n) => getComputedStyle(n).opacity)).toBe("1");
    await help.tap();
    await expect(dialog.getByRole("tooltip")).toContainText("50점");
    const box = (await dialog.getByRole("tooltip").boundingBox())!;
    const width = page.viewportSize()!.width;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    // Reading the rule did not record anything.
    await expect(dialog).toBeVisible();
    await expect(page.locator(".scoreboard .fixed-score")).toHaveCount(0);
    await dialog.locator(".mobile-quick-group-title").first().tap();
    await expect(page.getByRole("tooltip")).toHaveCount(0);
    await expect(dialog).toBeVisible(); // closing the tooltip does not close the sheet
    await dialog.getByRole("button", { name: "상단 보너스 설명" }).tap();
    await expect(dialog.getByRole("tooltip")).toContainText("63점 이상");
    await page.screenshot({ path: `test-results/tooltip-${test.info().project.name}.png` });
  }
});

test("족보 설명 아이콘은 이름 길이와 상관없이 이름 바로 뒤 같은 간격에 놓인다", async ({ page }) => {
  await page.goto("#play");
  let scope = page.locator(".scoreboard");
  if (isMobile(page)) {
    await page.getByRole("button", { name: "점수판 열기" }).click();
    scope = page.getByRole("dialog", { name: "점수판" });
  }
  const gaps = await scope.locator("[data-category]").evaluateAll((rows) =>
    rows
      .filter((r) => r.getBoundingClientRect().height > 0)
      .map((row) => {
        const names = row.querySelectorAll(".category-cell span:not(.category-icon):not(.category-label)");
        const name = (names[names.length - 1] ?? row.querySelector(".category-label span:last-child"))!.getBoundingClientRect();
        const help = row.querySelector(".category-help")!.getBoundingClientRect();
        return Math.round(help.left - name.right);
      }),
  );
  expect(gaps.length).toBe(12);
  expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(1);
  expect(Math.min(...gaps)).toBeGreaterThanOrEqual(0);
  expect(Math.max(...gaps)).toBeLessThanOrEqual(10);
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

test("게임 화면은 상단 홈·상품·설정과 넓은 보드를 제공하고 넘치지 않는다", async ({ page }) => {
  await page.goto("#play");
  const top = page.locator(".shell-top");
  const home = (await top.getByRole("button", { name: "홈으로" }).boundingBox())!;
  const settings = (await top.getByRole("button", { name: "설정", exact: true }).boundingBox())!;
  const width = page.viewportSize()!.width;
  expect(home.x).toBeLessThan(width / 4);
  expect(settings.x).toBeGreaterThan(width * 0.6);
  await expect(top.getByRole("button", { name: /효과음/ })).toHaveCount(0);
  await expect(top.getByRole("button", { name: "상점", exact: true })).toBeVisible();
  await expect(top.getByRole("button", { name: "인벤토리", exact: true })).toBeVisible();
  const board = (await page.getByLabel("게임 보드").boundingBox())!;
  if (isMobile(page)) expect(board.width).toBeGreaterThan(width - 40);
  else {
    await expect(top.getByRole("button", { name: "전체 화면" })).toHaveCount(0);
    expect(board.width).toBeGreaterThan(width * 0.55);
  }
  for (const b of await top.getByRole("button").all()) {
    const r = (await b.boundingBox())!;
    expect(Math.min(r.width, r.height)).toBeGreaterThanOrEqual(38);
  }
  expect(await noHorizontalScroll(page)).toBe(true);
});

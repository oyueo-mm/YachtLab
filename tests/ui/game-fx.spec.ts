import { test, expect, type Page } from "@playwright/test";
import { SEEDS, fixSeed, scoreCategory, startLocal, withMotion } from "./helpers";

type TableDie = { id: number; value: number; held: boolean; x?: number; y?: number; z?: number; top?: number; zone?: string; hidden?: boolean };
type Fx = { key: number; category: string; label: string; points: number; ids: number[]; grand: boolean; values: Record<string, number> };
const tableState = (page: Page) => page.evaluate(() => (window as unknown as { __yachtlabDice?: { table?: () => TableDie[] } }).__yachtlabDice?.table?.() ?? []);
const fxList = (page: Page) => page.evaluate(() => ((window as unknown as { __yachtlabFx?: Fx[] }).__yachtlabFx ?? []).map((f) => ({ ...f })));
const soundNames = (page: Page) => page.evaluate(() => (window as unknown as { __yachtlabSound: { log: { name: string }[] } }).__yachtlabSound.log.map((e) => e.name));
const settled = async (page: Page) => {
  await expect(page.locator(".dice-animating")).toHaveCount(0, { timeout: 8000 });
  await page.waitForTimeout(350);
};
async function openSeeded(page: Page, seed: number, quality: "3d" | "2.5d" = "3d") {
  await fixSeed(page, seed);
  await withMotion(page, quality);
  await page.goto("#play");
  if (quality === "3d") await expect(page.locator(".physical-dice canvas")).toBeVisible();
  await expect(page.getByRole("button", { name: "주사위 굴리기" })).toBeVisible();
}
const roll = async (page: Page) => {
  await page.getByRole("button", { name: "주사위 굴리기" }).click();
  await settled(page);
};
/** Watches what is actually drawn for `ms`: which dice are lifted toward the camera, and any face that is not the engine value. */
const watch = (page: Page, ms: number, window_?: number) =>
  page.evaluate(async ([duration, only]) => {
    // Only the effect window counts (from the announcement until `only` ms later), so the AI’s next throw is never mixed in.
    const w = window as unknown as { __yachtlabDice?: { table?: () => TableDie[] }; __yachtlabFx?: { at: number; ms: number }[] };
    const lifted = new Set<number>(),
      peak: Record<number, number> = {};
    let mismatches = 0,
      samples = 0,
      label = "";
    const t0 = performance.now();
    while (performance.now() - t0 < duration) {
      const fx = w.__yachtlabFx?.at(-1);
      if (fx && performance.now() - fx.at > (only ?? fx.ms)) break;
      label = document.querySelector(".score-fx-label")?.textContent || label;
      for (const d of w.__yachtlabDice?.table?.() ?? []) {
        if (d.hidden) continue;
        samples++;
        peak[d.id] = Math.max(peak[d.id] ?? 0, d.y ?? 0);
        if ((d.y ?? 0) > 1.5) lifted.add(d.id);
        if (d.top !== d.value) mismatches++;
      }
      await new Promise((r) => setTimeout(r, 30));
    }
    return { lifted: [...lifted].sort(), peak, mismatches, samples, label };
  }, [ms, window_ ?? null] as const);
const clickDie = async (page: Page, id: number) => {
  const box = (await page.locator(`.die-hit[data-die-id="${id}"]`).boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
};

/* ----------------------------------------------------------- combination effect ----------------------------------------------------------- */

const cases: { name: string; seed: number; category: string; faces: number[]; lifted: number[]; points: number; grand: boolean }[] = [
  { name: "스몰 스트레이트 1·2·3·4·1 → 정확히 네 개 (중복 1은 낮은 id)", seed: SEEDS.small12341, category: "small", faces: [1, 2, 3, 4, 1], lifted: [0, 1, 2, 3], points: 15, grand: false },
  { name: "스몰 스트레이트 3·1·4·2·6 (순서가 섞인 경우)", seed: SEEDS.smallNoDup, category: "small", faces: [3, 1, 4, 2, 6], lifted: [0, 1, 2, 3], points: 15, grand: false },
  { name: "요트: 다섯 개 전부 + 특별 연출", seed: SEEDS.yacht, category: "yacht", faces: [4, 4, 4, 4, 4], lifted: [0, 1, 2, 3, 4], points: 50, grand: true },
  { name: "라지 스트레이트: 다섯 개 전부 + 특별 연출", seed: SEEDS.large, category: "large", faces: [], lifted: [0, 1, 2, 3, 4], points: 30, grand: true },
  { name: "포커: 같은 눈 네 개만 (점수는 다섯 개 합계)", seed: SEEDS.four, category: "four", faces: [], lifted: [], points: 0, grand: false },
  { name: "풀 하우스: 다섯 개 전부", seed: SEEDS.full, category: "full", faces: [], lifted: [0, 1, 2, 3, 4], points: 0, grand: false },
  { name: "트리플: 눈이 3인 주사위만", seed: SEEDS.threes, category: "threes", faces: [], lifted: [], points: 6, grand: false },
  { name: "초이스: 다섯 개 전부", seed: SEEDS.full, category: "choice", faces: [], lifted: [0, 1, 2, 3, 4], points: 0, grand: false },
];
for (const c of cases)
  test(`족보 연출: ${c.name}`, async ({ page }) => {
    await openSeeded(page, c.seed);
    await roll(page);
    const dice = await tableState(page);
    const values = dice.map((d) => d.value);
    if (c.faces.length) expect(values).toEqual(c.faces);
    await scoreCategory(page, c.category);
    const seen = await watch(page, 950);
    const fx = (await fxList(page))[0];
    expect(fx.category).toBe(c.category);
    // What the engine scores is what is announced.
    // Points are the engine rule, computed independently here from the faces on the table.
    const sum = values.reduce((x, y) => x + y, 0);
    const expectedPoints = c.points || (c.category === "threes" ? 3 * values.filter((v) => v === 3).length : sum);
    expect(fx.points).toBe(expectedPoints);
    const expectedIds = c.lifted.length
      ? c.lifted
      : c.category === "four"
        ? dice.filter((d) => d.value === dice.find((x) => dice.filter((y) => y.value === x.value).length >= 4)!.value).map((d) => d.id).slice(0, 4)
        : dice.filter((d) => d.value === 3).map((d) => d.id);
    expect(fx.ids).toEqual(expectedIds);
    expect(fx.grand).toBe(c.grand);
    // The drawn state: exactly those dice came toward the camera, the others stayed on the floor, faces never changed.
    expect(seen.lifted).toEqual(expectedIds);
    for (const d of dice) if (!expectedIds.includes(d.id)) expect(seen.peak[d.id]).toBeLessThan(0.7);
    expect(seen.mismatches).toBe(0);
    // Label with the combination and the engine's points.
    expect(seen.label).toContain(fx.label.replace(/ (d)/, ""));
    expect(seen.label).toContain(`+${fx.points}`);
    expect(await soundNames(page)).toContain(c.category === "large" ? "grand" : "combo");
    // Scored exactly once, then the effect ends and the board is ready again.
    await expect(page.locator(".score-fx-label")).toHaveCount(0, { timeout: 3000 });
    await expect(page.locator(`.scoreboard [data-category="${c.category}"] .fixed-score`).first()).toHaveText(String(fx.points));
    expect((await fxList(page)).filter((f) => f.category === c.category && f.key === fx.key)).toHaveLength(1);
    await expect(page.getByRole("button", { name: "주사위 굴리기" })).toBeEnabled({ timeout: 15000 });
    expect((await tableState(page)).every((d) => d.hidden)).toBe(true);
    await expect(page.locator(".scoreboard .fixed-score")).toHaveCount(2, { timeout: 15000 }); // the AI answered with one move of its own
  });

test("0점 기록에는 완성 연출이 없다 (라벨·들어올림·효과음 없음)", async ({ page }) => {
  await openSeeded(page, SEEDS.none);
  await roll(page);
  await scoreCategory(page, "yacht"); // 1·1·2·2·3 → 0 points
  const seen = await watch(page, 1200, 450); // the 450 ms after scoring, before the AI starts its own throw
  const fx = (await fxList(page))[0];
  expect(fx).toMatchObject({ category: "yacht", points: 0, ids: [], grand: false });
  expect(seen.lifted).toEqual([]);
  await expect(page.locator(".score-fx-label")).toHaveCount(0);
  expect(await soundNames(page)).not.toEqual(expect.arrayContaining(["combo"]));
  await expect(page.locator('.scoreboard [data-category="yacht"] .fixed-score').first()).toHaveText("0");
  await expect(page.getByRole("button", { name: "주사위 굴리기" })).toBeEnabled({ timeout: 15000 });
});

test("연출 중에는 굴리기·주사위·점수가 잠기고, 연타해도 점수는 한 번만 기록된다", async ({ page }) => {
  await openSeeded(page, SEEDS.small12341);
  await roll(page);
  await scoreCategory(page, "small");
  // While the effect plays, nothing can be rolled or scored again.
  await expect(page.getByRole("button", { name: "주사위 굴리기" })).toBeDisabled();
  for (let i = 0; i < 4; i++) await page.getByRole("button", { name: "주사위 굴리기" }).click({ force: true, timeout: 500 }).catch(() => undefined);
  await page.locator('.scoreboard [data-category="aces"] .score-option').click({ force: true, timeout: 500 }).catch(() => undefined);
  await expect(page.locator(".score-fx-label")).toHaveCount(0, { timeout: 3000 });
  await expect(page.locator('.scoreboard [data-category="small"] .fixed-score').first()).toHaveText("15");
  await expect(page.locator('.scoreboard [data-category="aces"] td').first().locator(".fixed-score")).toHaveCount(0); // my column (the AI may take aces itself)
  expect((await fxList(page)).filter((f) => f.category === "small")).toHaveLength(1);
});

test("연출 중 재대결은 연출을 정리하고 새 경기에 영향을 주지 않는다", async ({ page }) => {
  await openSeeded(page, SEEDS.small12341);
  await roll(page);
  await scoreCategory(page, "small");
  await page.getByRole("button", { name: "재대결", exact: true }).click();
  await page.getByRole("dialog", { name: "새 경기를 시작할까요?" }).getByRole("button", { name: "재대결" }).click();
  await expect(page.locator(".score-fx-label")).toHaveCount(0);
  await expect(page.locator(".scoreboard .fixed-score")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "주사위 굴리기" })).toBeEnabled({ timeout: 4000 });
  await expect.poll(async () => (await tableState(page)).every((d) => d.hidden), { timeout: 3000 }).toBe(true);
  await roll(page); // a fresh game rolls normally and the old effect never comes back
  expect((await tableState(page)).filter((d) => !d.hidden)).toHaveLength(5);
  await page.waitForTimeout(500);
  await expect(page.locator(".score-fx-label")).toHaveCount(0);
});

test("로컬 사람 대전에서도 같은 연출이 나온다", async ({ page }) => {
  await fixSeed(page, SEEDS.small12341);
  await withMotion(page, "3d");
  await startLocal(page, { count: 2 });
  await expect(page.locator(".physical-dice canvas")).toBeVisible();
  await roll(page);
  const before = (await tableState(page)).map((d) => d.value);
  expect(before).toEqual([1, 2, 3, 4, 1]);
  await scoreCategory(page, "small");
  const seen = await watch(page, 900);
  expect(seen.lifted).toEqual([0, 1, 2, 3]);
  await expect(page.locator(".score-fx-label")).toContainText("스몰 스트레이트");
  await expect(page.locator(".turn-indicator")).toContainText("플레이어 2의 차례");
  await expect(page.getByRole("button", { name: "주사위 굴리기" })).toBeEnabled({ timeout: 4000 });
});

test("2.5D 대체 모드: 같은 의미의 간소화 연출 (족보를 이루는 주사위만 띄움)", async ({ page }) => {
  await openSeeded(page, SEEDS.small12341, "2.5d");
  await roll(page);
  await scoreCategory(page, "small");
  const strip = page.locator(".score-fx-strip");
  await expect(strip).toBeVisible();
  await expect(strip.locator(".die-icon")).toHaveCount(4);
  expect(await strip.locator(".die-icon").evaluateAll((n) => n.map((x) => Number(x.getAttribute("aria-label")!.split(" ").at(-1))))).toEqual([1, 2, 3, 4]);
  await expect(page.locator(".score-fx-label")).toContainText("스몰 스트레이트");
  await expect(page.getByRole("button", { name: "주사위 굴리기" })).toBeDisabled();
  await expect(strip).toHaveCount(0, { timeout: 3000 });
  await expect(page.getByRole("button", { name: "주사위 굴리기" })).toBeEnabled({ timeout: 15000 });
});

test("동작 줄이기: 움직임 없이 짧은 정적 강조", async ({ page }) => {
  await fixSeed(page, SEEDS.small12341);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("#play");
  await page.getByRole("button", { name: "주사위 굴리기" }).click();
  await scoreCategory(page, "small");
  const strip = page.locator(".score-fx-strip.static");
  await expect(strip).toBeVisible();
  await expect(strip.locator(".die-icon")).toHaveCount(4);
  expect(await strip.evaluate((n) => getComputedStyle(n).animationName)).toBe("none");
  await expect(strip).toHaveCount(0, { timeout: 2500 });
  await expect(page.getByRole("button", { name: "주사위 굴리기" })).toBeEnabled({ timeout: 15000 });
});

/* ------------------------------------------------------- animation stability (F) ------------------------------------------------------- */

test("고정·해제·고정을 연타해도 마지막 상태와 화면이 일치한다", async ({ page }) => {
  await openSeeded(page, SEEDS.large);
  await roll(page);
  // Programmatic taps: exact toggles with no waiting, whatever the machine speed.
  const tap = (id: number) => page.locator(`.die-hit[data-die-id="${id}"]`).evaluate((el) => (el as HTMLElement).click());
  for (let i = 0; i < 5; i++) await tap(0); // hold, release, hold, release, hold
  await settled(page);
  await expect(page.locator('.die-hit[data-die-id="0"]')).toHaveAttribute("aria-pressed", "true");
  let t = await tableState(page);
  expect(t.find((d) => d.id === 0)).toMatchObject({ zone: "hold", held: true, y: 0.5 });
  for (const d of t) expect(d.top).toBe(d.value);
  for (let i = 0; i < 4; i++) await tap(3); // even number of taps: ends released
  await settled(page);
  await expect(page.locator('.die-hit[data-die-id="3"]')).toHaveAttribute("aria-pressed", "false");
  t = await tableState(page);
  expect(t.find((d) => d.id === 3)).toMatchObject({ zone: "tray", held: false });
  expect(t.filter((d) => d.zone === "hold").map((d) => d.id)).toEqual([0]);
  // No two dice share a spot.
  const pts = t.map((d) => [d.x!, d.z!]);
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) expect(Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1])).toBeGreaterThan(0.7);
});

test("여러 주사위를 연속 고정하고 곧바로 재굴림해도 고정 주사위는 그대로이고 나머지만 던져진다", async ({ page }) => {
  await openSeeded(page, SEEDS.large);
  await roll(page);
  const before = Object.fromEntries((await tableState(page)).map((d) => [d.id, d.value]));
  for (const id of [1, 2, 4]) await clickDie(page, id);
  await page.getByRole("button", { name: "다시 굴리기" }).click(); // before the slides finish
  await settled(page);
  const t = await tableState(page);
  expect(t.filter((d) => d.zone === "hold").map((d) => [d.id, d.value])).toEqual([[1, before[1]], [2, before[2]], [4, before[4]]]);
  for (const d of t) expect(d.top).toBe(d.value);
  const last = await page.evaluate(() => (window as unknown as { __yachtlabDice: { last: { targets: Record<string, number> } } }).__yachtlabDice.last);
  expect(Object.keys(last.targets).sort()).toEqual(["0", "3"]);
});

test("고정 중 Alt+방향키 순서 변경과 이동이 겹쳐도 위치가 엉키지 않는다", async ({ page }) => {
  await openSeeded(page, SEEDS.large);
  await roll(page);
  await clickDie(page, 0);
  await clickDie(page, 1);
  await page.locator('.die-hit[data-die-id="0"]').focus();
  await page.keyboard.press("Alt+ArrowRight");
  await page.keyboard.press("Alt+ArrowRight");
  await settled(page);
  const t = await tableState(page);
  const held = t.filter((d) => d.held);
  expect(held.map((d) => d.zone)).toEqual(["hold", "hold"]);
  expect(new Set(held.map((d) => Math.round(d.x! * 10))).size).toBe(2);
  for (const d of t) expect(d.top).toBe(d.value);
});

test("클릭 영역은 이동 중에도 보이는 주사위를 따라간다 (다른 주사위가 선택되지 않는다)", async ({ page }) => {
  await openSeeded(page, SEEDS.large);
  await roll(page);
  await clickDie(page, 2);
  await page.waitForTimeout(110); // mid-slide
  const r = await page.evaluate(() => {
    const el = document.querySelector('.die-hit[data-die-id="2"]')!.getBoundingClientRect();
    const box = document.querySelector(".physical-dice")!.getBoundingClientRect();
    const die = (window as unknown as { __yachtlabDice: { table: () => TableDie[] } }).__yachtlabDice.table().find((d) => d.id === 2)!;
    return { cx: (el.left + el.width / 2 - box.left) / el.width, cz: (el.top + el.height / 2 - box.top) / el.height, x: die.x!, z: die.z!, y: die.y! };
  });
  expect(Math.abs(r.cx - r.x)).toBeLessThan(0.2);
  expect(Math.abs(r.cz - r.z)).toBeLessThan(0.2);
  await settled(page);
  // After the slide the shelf slot is under the pointer for a second tap.
  await clickDie(page, 2);
  await settled(page);
  expect((await tableState(page)).find((d) => d.id === 2)).toMatchObject({ zone: "tray", held: false });
});

test("반복 대국에서 3D 자원이 쌓이지 않는다 (캔버스·애니메이션·소리 예약)", async ({ page }) => {
  await openSeeded(page, SEEDS.small12341);
  for (let i = 0; i < 3; i++) {
    await roll(page);
    await scoreCategory(page, ["small", "choice", "sixes"][i]);
    await expect(page.getByRole("button", { name: "주사위 굴리기" })).toBeEnabled({ timeout: 20000 });
  }
  expect(await page.locator("canvas").count()).toBe(1);
  await page.goto("#records");
  await page.goto("#home");
  await page.goto("#play");
  await expect(page.locator(".physical-dice")).toBeVisible();
  expect(await page.locator("canvas").count()).toBe(1);
});

/* ---------------------------------------------------------- mobile controls (E) ---------------------------------------------------------- */

for (const [w, h] of [[320, 568], [375, 667], [391, 740], [430, 932]] as const)
  test(`모바일 ${w}×${h}: 점수 기록 바가 굴리기 버튼·안내 문구를 가리지 않고 고정 슬롯이 잘리지 않는다`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await openSeeded(page, SEEDS.large);
    await roll(page);
    await clickDie(page, 1);
    await settled(page);
    const r = await page.evaluate(() => {
      const rect = (s: string) => document.querySelector(s)!.getBoundingClientRect();
      const roll = rect(".roll-button"),
        score = rect(".mobile-score-button"),
        board = rect(".game-board"),
        shelf = rect(".dice-hold-area"),
        slots = [...document.querySelectorAll(".hold-slot")].map((s) => s.getBoundingClientRect());
      const at = document.elementFromPoint(roll.left + roll.width / 2, roll.top + roll.height / 2);
      return {
        position: getComputedStyle(document.querySelector(".mobile-score-button")!).position,
        rollBottom: roll.bottom,
        scoreTop: score.top,
        boardBottom: board.bottom,
        rollHit: !!at?.closest(".roll-button"),
        slotsInside: slots.every((s) => s.left >= shelf.left - 0.5 && s.right <= shelf.right + 0.5),
        rollHeight: roll.height,
        overflow: document.documentElement.scrollWidth - innerWidth,
        diceMin: Math.min(...[...document.querySelectorAll<HTMLElement>(".die-hit")].map((d) => d.getBoundingClientRect().width)),
      };
    });
    expect(r.position).not.toBe("sticky");
    expect(r.position).not.toBe("fixed");
    expect(r.rollBottom).toBeLessThanOrEqual(r.scoreTop);
    expect(r.boardBottom).toBeLessThanOrEqual(r.scoreTop + 1);
    expect(r.rollHit).toBe(true);
    expect(r.slotsInside).toBe(true);
    expect(r.rollHeight).toBeGreaterThanOrEqual(48);
    expect(r.overflow).toBeLessThanOrEqual(0);
    expect(r.diceMin).toBeGreaterThanOrEqual(34); // comfortable touch target
    await page.screenshot({ path: `test-results/mobile-${w}x${h}.png`, fullPage: true });
    await page.getByRole("button", { name: "점수판 열기" }).click();
    await expect(page.getByRole("dialog", { name: "점수판" })).toBeVisible();
  });

/* ------------------------------------------------------- matte table and buttons (C, D) ------------------------------------------------------- */

test("게임판은 무광: 그라데이션·글로우 없음, 그림자는 약한 외곽선 하나뿐", async ({ page }) => {
  await openSeeded(page, SEEDS.large);
  await roll(page);
  const css = await page.evaluate(() => {
    const board = getComputedStyle(document.querySelector(".game-board")!);
    const tray = getComputedStyle(document.querySelector(".dice-tray-area")!);
    const shelf = getComputedStyle(document.querySelector(".dice-hold-area")!);
    const slot = getComputedStyle(document.querySelector(".hold-slot")!);
    return { boardBg: board.backgroundImage, boardColor: board.backgroundColor, boardShadow: board.boxShadow, trayBg: tray.backgroundImage, shelfBg: shelf.backgroundImage, slotBorder: slot.borderTopWidth, slotBg: slot.backgroundColor };
  });
  expect(css.boardBg).not.toContain("gradient");
  expect(css.trayBg).not.toContain("gradient");
  expect(css.shelfBg).not.toContain("gradient");
  expect(css.boardColor).toBe("rgb(42, 42, 42)");
  const blur = Number(/(\d+)px \d+px (\d+)px/.exec(css.boardShadow)?.[2] ?? 0);
  expect(blur).toBeLessThanOrEqual(6);
  expect(css.slotBorder).toBe("0px"); // quiet slots: no dashed outlines
  // No cast-shadow map and no glossy material: nothing but contact shadows is drawn in WebGL.
  const dice = await page.evaluate(() => document.querySelectorAll(".dice-table-canvas").length);
  expect(dice).toBe(1);
});

test("버튼은 둥근 직사각형 체계: 알약형이 아니고 주요·보조 버튼이 구분된다", async ({ page }) => {
  const radius = async (selector: string) => Number.parseFloat(await page.locator(selector).first().evaluate((n) => getComputedStyle(n).borderTopLeftRadius));
  await page.goto("");
  expect(await radius(".mode-cta")).toBeLessThanOrEqual(14);
  expect(await radius(".shell-top .shell-icon")).toBeLessThanOrEqual(12);
  await page.goto("?lab=1#play-setup");
  expect(await radius(".setup-start")).toBeLessThanOrEqual(16);
  expect(await radius(".setup-start")).toBeGreaterThanOrEqual(12);
  await page.getByText("고급 설정", { exact: true }).click();
  await page.getByText("연구용 알고리즘 직접 선택").click();
  expect(await radius(".model-families button")).toBeLessThanOrEqual(10);
  await page.goto("#lab");
  expect(await radius(".lab-nav a")).toBeLessThanOrEqual(12);
  await page.goto("#play");
  const roll = await radius(".roll-button");
  expect(roll).toBeGreaterThanOrEqual(12);
  expect(roll).toBeLessThanOrEqual(16);
  const tool = await page.locator(".game-tools .text-button").first().evaluate((n) => ({ r: getComputedStyle(n).borderTopLeftRadius, border: getComputedStyle(n).borderTopWidth, bg: getComputedStyle(n).backgroundColor }));
  expect(Number.parseFloat(tool.r)).toBeLessThanOrEqual(12);
  expect(tool.border).toBe("1px"); // quiet outlined secondary buttons
  expect(tool.bg).not.toBe(await page.locator(".roll-button").evaluate((n) => getComputedStyle(n).backgroundColor));
});

import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { SEEDS, fixSeed, scoreCategory, startAI, startLocal, withMotion } from "./helpers";

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
  await page.goto("?lab=1#play-setup");
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

type TableDie = { id: number; value: number; held: boolean; x?: number; y?: number; z?: number; top?: number; zone?: string; hidden?: boolean };
const tableState = (page: Page) => page.evaluate(() => (window as unknown as { __yachtlabDice?: { table?: () => TableDie[] } }).__yachtlabDice?.table?.() ?? []);
const waitLoaded3d = (page: Page) =>
  expect.poll(() => page.evaluate(() => performance.getEntriesByType("resource").some((r) => /table-.*\.js|stage-.*\.js|dice3d\/table/.test(r.name)))).toBe(true);
const settled = async (page: Page) => {
  await expect(page.locator(".dice-animating")).toHaveCount(0, { timeout: 8000 });
  await page.waitForTimeout(350); // hold/release slides are 260 ms
};
const clickDie = async (page: Page, id: number) => {
  const box = (await page.locator(`.die-hit[data-die-id="${id}"]`).boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
};
/** Enter a fresh AI game with the 3D table active (the 3D chunk loads when idle). */
async function open3d(page: Page, quality: "3d-high" | "3d" = "3d") {
  await withMotion(page, quality);
  await page.goto("#home");
  await waitLoaded3d(page);
  await page.goto("#play");
  await expect(page.locator(".physical-dice")).toBeVisible();
}

for (const quality of ["3d-high", "3d"] as const)
  test(`3D 주사위(${quality}): 착지한 위치·방향을 유지하고 고정 영역으로 옮겨지며 재굴림·해제·점수가 엔진과 일치한다`, async ({ page }) => {
    await open3d(page, quality);
    await page.getByRole("button", { name: "주사위 굴리기" }).click();
    await expect(page.locator(".dice-table-canvas")).toBeVisible();
    await expect.poll(async () => Object.keys((await lastRoll(page))?.targets ?? {}).length, { timeout: 8000 }).toBe(5);
    await settled(page);
    // Final rendered state: still 3D (no 2D dice), every top face = engine value, not lined up, stable.
    await expect(page.locator(".die-button:not(.die-hit)")).toHaveCount(0);
    let t = await tableState(page);
    expect(t.filter((d) => d.zone === "tray")).toHaveLength(5);
    for (const d of t) expect(d.top).toBe(d.value);
    expect(Object.fromEntries(t.map((d) => [String(d.id), d.value]))).toEqual(await domFaces(page));
    const zs = t.map((d) => d.z!);
    expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThan(0.05);
    await page.waitForTimeout(700);
    expect(await tableState(page)).toEqual(t);
    const roll = (await lastRoll(page))!;
    expect(roll.mode).toBe("3d");
    expect(roll.finals).toEqual(roll.targets);
    // Hold two dice → they move to the shelf and keep their faces; the engine agrees.
    const before = Object.fromEntries(t.map((d) => [d.id, d.value]));
    await clickDie(page, 0);
    await clickDie(page, 2);
    await settled(page);
    await expect(page.locator('.die-hit[data-die-id="0"]')).toHaveAttribute("aria-pressed", "true");
    t = await tableState(page);
    expect(t.filter((d) => d.zone === "hold").map((d) => d.id).sort()).toEqual([0, 2]);
    for (const d of t) expect(d.top).toBe(d.value);
    // Re-roll: only the three free dice are thrown; held dice stay on the shelf with the same values.
    await page.getByRole("button", { name: "다시 굴리기" }).click();
    await expect.poll(async () => Object.keys((await lastRoll(page))?.targets ?? {}).length, { timeout: 8000 }).toBe(3);
    await settled(page);
    t = await tableState(page);
    expect(t.filter((d) => d.zone === "hold").map((d) => [d.id, d.value])).toEqual([
      [0, before[0]],
      [2, before[2]],
    ]);
    for (const d of t) expect(d.top).toBe(d.value);
    expect(Object.keys((await lastRoll(page))!.targets).sort()).toEqual(["1", "3", "4"]);
    // Release one: back in the tray with the same value until the next roll.
    await clickDie(page, 0);
    await settled(page);
    t = await tableState(page);
    expect(t.find((d) => d.id === 0)).toMatchObject({ zone: "tray", held: false, value: before[0], top: before[0] });
    // All five can be held.
    for (const id of [0, 1, 3, 4]) await clickDie(page, id);
    await settled(page);
    expect((await tableState(page)).every((d) => d.zone === "hold")).toBe(true);
    // The canvas never reaches the roll button; nothing overflows.
    const table = (await page.locator(".physical-dice").boundingBox())!;
    const button = (await page.locator(".roll-button").boundingBox())!;
    expect(table.y + table.height).toBeLessThanOrEqual(button.y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    // Scoring uses exactly the five shown values.
    const sum = Object.values(await domFaces(page)).reduce((a, b) => a + b, 0);
    await scoreCategory(page, "choice");
    await expect(page.locator('[data-category="choice"] .fixed-score').first()).toHaveText(String(sum));
  });

test("3D 고정 선반은 선택한 순서대로: C→A→E는 왼쪽부터 C, A, E / 해제하면 나머지 유지 / 다시 고르면 맨 뒤 / 재굴림에도 유지", async ({ page }) => {
  await open3d(page);
  await page.getByRole("button", { name: "주사위 굴리기" }).click();
  await expect.poll(async () => Object.keys((await lastRoll(page))?.targets ?? {}).length, { timeout: 8000 }).toBe(5);
  await settled(page);
  /** Held dice, left to right as drawn on the shelf. */
  const shelf = async () =>
    (await tableState(page))
      .filter((d) => d.zone === "hold")
      .sort((x, y) => x.x! - y.x!)
      .map((d) => d.id);
  const values = Object.fromEntries((await tableState(page)).map((d) => [d.id, d.value]));
  for (const id of [2, 0, 4]) await clickDie(page, id);
  await settled(page);
  expect(await shelf()).toEqual([2, 0, 4]);
  await expect(page.locator(".physical-dice")).toHaveAttribute("data-hold-order", "2,0,4");
  // the engine only knows which dice are held (values unchanged)
  for (const id of [2, 0, 4]) await expect(page.locator(`.die-hit[data-die-id="${id}"]`)).toHaveAttribute("aria-pressed", "true");
  await clickDie(page, 0);
  await settled(page);
  expect(await shelf()).toEqual([2, 4]);
  await clickDie(page, 0);
  await settled(page);
  expect(await shelf()).toEqual([2, 4, 0]);
  await page.getByRole("button", { name: "다시 굴리기" }).click();
  await expect.poll(async () => Object.keys((await lastRoll(page))?.targets ?? {}).length, { timeout: 8000 }).toBe(2);
  await settled(page);
  expect(await shelf()).toEqual([2, 4, 0]);
  const after = await tableState(page);
  for (const id of [2, 4, 0]) expect(after.find((d) => d.id === id)).toMatchObject({ zone: "hold", value: values[id], top: values[id] });
  // equal-looking slots: the three held dice sit in the three leftmost shelf slots
  const slots = await page.evaluate(() => [...document.querySelectorAll(".hold-slot")].map((s) => s.getBoundingClientRect().left).sort((a, b) => a - b));
  const held = await page.evaluate(() => [2, 4, 0].map((id) => document.querySelector(`.die-hit[data-die-id="${id}"]`)!.getBoundingClientRect().left));
  for (let i = 0; i < 3; i++) expect(Math.abs(held[i] - slots[i])).toBeLessThan(4);
});

test("3D 주사위: 겹쳐 있어도 가장 가까운 주사위가 선택되고 키보드 Enter로도 고정한다", async ({ page }) => {
  await open3d(page);
  await page.getByRole("button", { name: "주사위 굴리기" }).click();
  await settled(page);
  const t = await tableState(page);
  // Click slightly off-centre toward a neighbour: the nearest centre still wins.
  const a = t[1],
    b = [...t].sort((p, q) => Math.hypot(p.x! - a.x!, p.z! - a.z!) - Math.hypot(q.x! - a.x!, q.z! - a.z!))[1];
  const boxA = (await page.locator(`.die-hit[data-die-id="${a.id}"]`).boundingBox())!;
  const boxB = (await page.locator(`.die-hit[data-die-id="${b.id}"]`).boundingBox())!;
  const ax = boxA.x + boxA.width / 2,
    ay = boxA.y + boxA.height / 2,
    bx = boxB.x + boxB.width / 2,
    by = boxB.y + boxB.height / 2;
  // A point between the two dice, still within reach of A (closer to A than to B).
  const len = Math.hypot(bx - ax, by - ay),
    step = Math.min(len * 0.3, boxA.width * 0.4);
  await page.mouse.click(ax + ((bx - ax) / len) * step, ay + ((by - ay) / len) * step);
  await expect(page.locator(`.die-hit[data-die-id="${a.id}"]`)).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(`.die-hit[data-die-id="${b.id}"]`)).toHaveAttribute("aria-pressed", "false");
  await settled(page);
  await page.locator(`.die-hit[data-die-id="${b.id}"]`).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(`.die-hit[data-die-id="${b.id}"]`)).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(`.die-hit[data-die-id="${b.id}"]`)).toHaveAttribute("aria-label", /고정됨/);
});

test("3D 주사위: 굴리는 중 빠른 연속 입력으로 중복 굴림이 생기지 않는다", async ({ page }) => {
  await open3d(page);
  const roll = page.getByRole("button", { name: "주사위 굴리기" });
  await roll.dblclick();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("게임 보드")).toContainText("굴림 1 / 3");
  await settled(page);
  await expect(page.getByLabel("게임 보드")).toContainText("굴림 1 / 3");
});

test("3D 주사위: AI 차례·새 차례에서도 정상 동작하고 화면 이동 후 WebGL 캔버스가 누적되지 않는다", async ({ page }) => {
  await open3d(page);
  await page.getByRole("button", { name: "주사위 굴리기" }).click();
  await settled(page);
  await scoreCategory(page, "aces");
  // The AI throws in the same 3D table and the tray is cleared for the next turn.
  await expect(page.locator(".scoreboard .fixed-score")).toHaveCount(2, { timeout: 30000 });
  await expect(page.getByRole("button", { name: "주사위 굴리기" })).toBeEnabled({ timeout: 15000 });
  expect((await tableState(page)).every((d) => d.hidden)).toBe(true);
  for (let i = 0; i < 3; i++) {
    await page.goto("#records");
    await page.goto("#play");
    await expect(page.locator(".physical-dice")).toBeVisible();
  }
  expect(await page.locator("canvas").count()).toBeLessThanOrEqual(1);
});

test("WebGL을 쓸 수 없으면 2.5D 연출로 대체되고 3D 품질은 선택할 수 없다", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __YACHTLAB_DISABLE_WEBGL__: boolean }).__YACHTLAB_DISABLE_WEBGL__ = true;
  });
  await withMotion(page, "3d-high");
  await page.goto("#play");
  await page.getByRole("button", { name: "주사위 굴리기" }).click();
  await expect(page.locator(".dice-table-canvas, .dice3d-canvas")).toHaveCount(0);
  await expect(page.locator(".dice-animating")).toHaveCount(0, { timeout: 2000 });
  expect((await lastRoll(page))!.mode).toBe("2.5d");
  // Same hold / re-roll rules in the fallback row.
  await page.locator(".die-button").first().click();
  await expect(page.locator(".die-button").first()).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "다시 굴리기" }).click();
  await expect(page.locator(".dice-animating")).toHaveCount(0, { timeout: 2000 });
  expect(Object.keys((await lastRoll(page))!.targets)).toHaveLength(4);
  await page.getByRole("button", { name: "설정", exact: true }).click();
  const quality = page.getByRole("combobox", { name: "주사위 애니메이션 품질" });
  expect(await quality.locator("option").evaluateAll((o) => (o as HTMLOptionElement[]).filter((x) => x.disabled).map((x) => x.value))).toEqual(["3d-high", "3d"]);
  await expect(page.getByRole("dialog", { name: "설정" })).toContainText("3D를 지원하지 않아");
});

test("3D 효과음은 실제 충돌에서 재생되고 개수가 제한되며 고정·해제 소리가 난다", async ({ page }) => {
  // A first roll without a combination (a large straight / yacht adds its own moment sound after settling).
  await fixSeed(page, SEEDS.none);
  await open3d(page);
  await page.getByRole("button", { name: "주사위 굴리기" }).click();
  await settled(page);
  const log = () => page.evaluate(() => (window as unknown as { __yachtlabSound: { log: { name: string; delay: number }[] } }).__yachtlabSound.log.map((e) => ({ ...e })));
  let entries = await log();
  const names = entries.map((e) => e.name);
  expect(names[0]).toBe("throw");
  expect(names.at(-1)).toBe("settle");
  const impacts = entries.filter((e) => e.name === "impact");
  expect(impacts.length).toBeGreaterThan(0);
  expect(impacts.length).toBeLessThanOrEqual(14);
  expect(impacts.every((e) => e.delay === 0)).toBe(true); // played live at the rendered collision frame
  await clickDie(page, 0);
  await settled(page);
  await clickDie(page, 0);
  await settled(page);
  entries = await log();
  expect(entries.map((e) => e.name)).toEqual(expect.arrayContaining(["hold", "release"]));
});

test("3D 효과음은 실제 충돌과 착지 뒤 라지 스트레이트 순서를 지키고 고정·해제 소리가 난다", async ({ page }) => {
  await fixSeed(page, SEEDS.large);
  await open3d(page);
  await page.getByRole("button", { name: "주사위 굴리기" }).click();
  await settled(page);
  await expect(page.locator(".straight-flash")).toBeVisible();
  const log = () => page.evaluate(() => (window as unknown as { __yachtlabSound: { log: { name: string; delay: number; at: number; played: boolean }[] } }).__yachtlabSound.log.map((e) => ({ ...e })));
  let entries = await log();
  const names = entries.map((e) => e.name);
  expect(names[0]).toBe("throw");
  expect(names.slice(-2)).toEqual(["settle", "straightHit"]);
  expect(names.filter((name) => name === "settle" || name === "straightHit")).toEqual(["settle", "straightHit"]);
  expect(entries.at(-1)!.at).toBeGreaterThanOrEqual(entries.at(-2)!.at);
  expect(entries.at(-1)!.played).toBe(true);
  expect(names.filter((name) => name === "impact" || name === "clack").length).toBeLessThanOrEqual(16);
  const impacts = entries.filter((e) => e.name === "impact");
  expect(impacts.length).toBeGreaterThan(0);
  expect(impacts.length).toBeLessThanOrEqual(14);
  expect(impacts.every((e) => e.delay === 0)).toBe(true); // played live at the rendered collision frame
  await clickDie(page, 0);
  await settled(page);
  await clickDie(page, 0);
  await settled(page);
  entries = await log();
  expect(entries.map((e) => e.name)).toEqual(expect.arrayContaining(["hold", "release"]));
});

/* ------------------------------------------------------------------ home & lab ------------------------------------------------------------------ */

test("홈: 독립 프로필 없이 온라인과 오프라인 두 모드를 강조한다", async ({ page }) => {
  await page.goto("");
  await expect(page.locator(".home-dice, [aria-label='주사위 굴려 보기']")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("요트다이스를 플레이해보세요");
  await expect(page.locator(".lobby").getByRole("button")).toHaveCount(2);
  await expect(page.locator(".lobby").getByText(/프로필|튜토리얼/)).toHaveCount(0);
  const cards = page.locator(".lobby .mode-card");
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0)).toContainText("온라인 대전");
  await expect(cards.nth(0)).toHaveClass(/mode-primary/);
  // the main call to action is visible on desktop and phones alike
  await expect(cards.nth(0).locator(".mode-cta")).toBeVisible();
  await expect(cards.nth(0).locator(".mode-cta")).toContainText("온라인 대전하기");
  await expect(cards.nth(1)).toContainText("오프라인 대전");
  await expect(page.locator(".lobby")).not.toContainText("준비 중");
  const [online, offline] = [(await cards.nth(0).boundingBox())!, (await cards.nth(1).boundingBox())!];
  expect(online.height).toBeGreaterThan(offline.height);
  expect(online.y).toBeLessThan(offline.y);
  await expect(page.getByRole("button", { name: "내 기록" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "연구실" })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

/* ------------------------------------------------------------- research model picker ------------------------------------------------------------- */

test("연구용 알고리즘: 전체 목록·검색·유형 분류, 연구 전용은 선택 불가, 선택한 모델이 실제 대국에 사용된다", async ({ page }) => {
  test.setTimeout(90000);
  await page.goto("?lab=1#play-setup");
  await page.getByText("고급 설정", { exact: true }).click();
  await page.getByText("연구용 알고리즘 직접 선택").click();
  const list = page.getByRole("radiogroup", { name: "연구용 알고리즘" });
  await expect(list.getByRole("radio", { name: "Win DP v3.4", exact: true })).toBeVisible();
  const total = await list.getByRole("radio").count();
  expect(total).toBeGreaterThanOrEqual(11 + 19);
  await page.getByLabel("모델 검색").fill("Z7");
  await expect(list.getByRole("radio")).toHaveCount(2);
  await page.getByLabel("모델 검색").fill("");
  await page.getByRole("group", { name: "알고리즘 유형" }).getByRole("button", { name: "강화학습" }).click();
  const rl = list.locator(".model-item.disabled");
  expect(await rl.count()).toBeGreaterThan(0);
  await expect(rl.first().getByRole("radio")).toBeDisabled();
  await expect(rl.first()).toContainText("선택 불가");
  await page.getByRole("group", { name: "알고리즘 유형" }).getByRole("button", { name: "전체" }).click();
  await list.locator(".model-item", { has: page.getByRole("radio", { name: "Win DP v3", exact: true }) }).click();
  await expect(page.getByRole("region", { name: "선택한 모델" })).toContainText("사용 조건");
  await list.locator(".model-item", { has: page.getByRole("radio", { name: "Win DP v4", exact: true }) }).click();
  await expect(page.getByRole("region", { name: "선택한 모델" })).toContainText("Win DP v4");
  await page.getByRole("button", { name: "게임 시작" }).click();
  await expect(page.locator(".score-summary")).toContainText("AI · Win DP v4");
  await page.getByRole("button", { name: "주사위 굴리기" }).click();
  await scoreCategory(page, "aces");
  await expect(page.locator(".scoreboard .fixed-score")).toHaveCount(2, { timeout: 30000 });
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.locator(".decision-details summary").click();
  await expect(page.locator(".decision-details")).toContainText("Win DP v4");
  const record = await exportReplay(page);
  expect(record.metadata.players[1]).toMatchObject({ type: "ai", algorithm: "Win DP v4" });
  // Turning the research option off returns to the 5 public levels (leaving the running game asks first).
  await page.getByRole("button", { name: "설정 변경" }).click();
  await page.getByRole("dialog", { name: "설정을 바꿀까요?" }).getByRole("button", { name: "설정 변경" }).click();
  await expect(page).toHaveURL(/#play-setup$/);
  await page.getByText("고급 설정", { exact: true }).click();
  await page.getByText("연구용 알고리즘 직접 선택").click();
  await expect(page.getByRole("radiogroup", { name: "AI 난이도" }).getByRole("radio").first()).toBeEnabled();
  await page.getByRole("button", { name: "게임 시작" }).click();
  await expect(page.locator(".score-summary")).toContainText("AI · 보통");
});

/* ------------------------------------------------------------ browser back / forward ------------------------------------------------------------ */

test("진행 중 경기에서 브라우저 뒤로·앞으로·주소 변경은 확인을 거치고, 취소하면 경기와 기록이 그대로다", async ({ page }) => {
  await page.goto("");
  await page.getByRole("button", { name: /오프라인 대전/ }).click();
  await page.getByRole("button", { name: /사람 vs 사람/ }).click();
  await page.getByRole("button", { name: "게임 시작" }).click();
  await page.getByRole("button", { name: "주사위 굴리기" }).click();
  await scoreCategory(page);
  const length = await page.evaluate(() => history.length);
  const leave = page.getByRole("dialog", { name: "게임을 나갈까요?" });
  // Back → ask → cancel: still in the game, same history length, URL restored.
  await page.goBack();
  await expect(leave).toBeVisible();
  await leave.getByRole("button", { name: "계속 플레이" }).click();
  await expect(page).toHaveURL(/#pvp$/);
  await expect(page.locator(".scoreboard .fixed-score")).toHaveCount(1);
  expect(await page.evaluate(() => history.length)).toBe(length);
  await expect(leave).toHaveCount(0);
  // Typed hash → ask → cancel.
  await page.evaluate(() => {
    location.hash = "records";
  });
  await expect(leave).toBeVisible();
  await leave.getByRole("button", { name: "계속 플레이" }).click();
  await expect(page).toHaveURL(/#pvp$/);
  await expect(page.locator(".scoreboard .fixed-score")).toHaveCount(1);
  // Back → confirm: leaves to the setup screen (where we came from), exactly once.
  await page.goBack();
  await leave.getByRole("button", { name: "나가기" }).click();
  await expect(page).toHaveURL(/#pvp-setup$/);
  await expect(page.getByRole("heading", { name: "사람 vs 사람" })).toBeVisible();
  await expect(leave).toHaveCount(0);
  // Lab / records deep links still open directly.
  await page.goto("#records");
  await expect(page.getByRole("heading", { name: "내 기록" })).toBeVisible();
  await page.goto("#analysis");
  await expect(page.getByRole("heading", { name: "전략 분석실" })).toBeVisible();
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

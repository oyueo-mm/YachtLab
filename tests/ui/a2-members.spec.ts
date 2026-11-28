import { returningVisitorState } from "./visitor";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { startLocalWorker, type LocalWorker } from "../helpers/wrangler";
import { fakeLogin, startFakeIdp, type FakeIdp } from "../helpers/fake-idp";
import { seedMember, type Wish } from "../helpers/member-look";
import { itemById } from "../../src/economy/live/catalog";

/**
 * Real equipped items through the real server (isolated local Worker + fake sign-in provider): each
 * member earns coins in real matches, buys items, saves a loadout; the other players receive the
 * server-validated looks. Checks that the TABLE (board surface, dice skin) follows the player on turn on
 * every screen in sequential play, stays each player's own in simultaneous play, and survives keep /
 * release / re-roll / turn change / reload / spectating. Dice are forced to the 2.5D view so the skin is
 * readable from the DOM (--die-face); the 3D table gets the same `colors` object.
 */
const ORIGIN = "http://127.0.0.1:5173";
let worker: LocalWorker;
let idp: FakeIdp;
const WISH: Record<string, Wish> = {
  a: { dice: "dice.mint", board: "board.felt_red" },
  b: { dice: "dice.pastel_pink", board: "board.felt_blue" },
  c: { dice: "dice.pastel_sky", board: "board.felt_sand" },
};
const sessions: Record<string, string> = {};
const contexts: BrowserContext[] = [];

test.beforeAll(async ({}, info) => {
  if (info.project.name === "mobile") return;
  test.setTimeout(400_000);
  idp = await startFakeIdp();
  worker = await startLocalWorker({
    ALLOWED_ORIGINS: ORIGIN, TURN_TIMEOUT_MS: "0", CREATE_PER_MINUTE: "500", JOIN_PER_MINUTE: "500",
    GOOGLE_CLIENT_ID: "test-client", GOOGLE_CLIENT_SECRET: "test-secret", AUTH_SECRET: "s".repeat(40), APP_URL: ORIGIN + "/YachtLab/", TEST_OIDC_ISSUER: idp.issuer, ECONOMY: "on",
  });
  for (const key of Object.keys(WISH)) sessions[key] = await fakeLogin(worker.url, idp, "a2-member-" + key, ORIGIN);
  // one at a time: the matchmaker pairs whoever queues, so parallel seeding would cross the pairs
  for (const key of Object.keys(WISH)) await seedMember(worker, sessions[key], "회원" + key.toUpperCase(), WISH[key]);
});
/**
 * The same three accounts play every test. A signed-in account cannot start another match while it is
 * still seated in one that is playing (C3 duplicate-match lock, D-094/D-095; a friend room with nobody
 * connected keeps its match for up to 15 minutes, D-046). So each test resigns what it left unfinished,
 * as a player would, before the next one starts. This only ends matches; it asserts nothing.
 */
async function resignUnfinished(pages: Page[]) {
  for (const p of pages) {
    const resign = p.getByRole("button", { name: "기권", exact: true }).first();
    if (!(await resign.isVisible().catch(() => false)) || !(await resign.isEnabled().catch(() => false))) continue;
    await resign.click().catch(() => undefined);
    await p.getByRole("dialog").getByRole("button", { name: "기권", exact: true }).click({ timeout: 3000 }).catch(() => undefined);
    await expect(p.locator(".game-result, .match-result").first()).toBeVisible({ timeout: 5000 }).catch(() => undefined);
  }
}
test.afterEach(async () => {
  await resignUnfinished(contexts.flatMap((c) => c.pages()));
  await Promise.all(contexts.splice(0).map((c) => c.close().catch(() => undefined)));
});
test.afterAll(async () => { await worker?.stop(); idp?.close(); });

const entry = (room?: string) => `?online-server=${encodeURIComponent(worker.url)}${room ? `&room=${room}` : ""}#online`;
async function device(browser: Browser, key: string | null, size = { width: 1366, height: 768 }): Promise<Page> {
  const ctx = await browser.newContext({ storageState: returningVisitorState(), viewport: size, baseURL: ORIGIN + "/YachtLab/", reducedMotion: "no-preference" });
  await ctx.addInitScript(([s, quality]) => {
    if (s) localStorage.setItem("yachtlab.session.v1", s);
    localStorage.setItem("yachtlab.settings.v1", JSON.stringify({ muted: true, diceQuality: quality }));
  }, [key ? sessions[key] : null, process.env.A2_DICE ?? "2.5d"] as const);
  contexts.push(ctx);
  return ctx.newPage();
}
const face = (key: string) => itemById(WISH[key].dice!)!.look.dice!.face.toLowerCase();
const boardColor = (key: string) => itemById(WISH[key].board!)!.look.board!.toLowerCase();
const tableOf = (p: Page) => p.evaluate((skipDice) => {
  const board = document.querySelector(".game-board") as HTMLElement | null;
  const dice = document.querySelector(".dice-themed") as HTMLElement | null;
  return { board: board?.style.getPropertyValue("--board-color").trim().toLowerCase() ?? "", dice: skipDice ? "-" : dice?.style.getPropertyValue("--die-face").trim().toLowerCase() ?? "" };
}, process.env.A2_DICE === "3d");
const expectTable = async (pages: Page[], key: string) => {
  for (const p of pages) await expect.poll(() => tableOf(p), { timeout: 8000, message: "table of " + key }).toEqual({ board: boardColor(key), dice: process.env.A2_DICE === "3d" ? "-" : face(key) });
};

/** Whose turn is it right now (the page whose roll button is enabled). */
async function turnPage(pages: Page[]): Promise<number> {
  let found = -1;
  await expect.poll(async () => {
    for (const [i, p] of pages.entries()) if (await p.locator(".roll-button").isEnabled().catch(() => false)) { found = i; return true; }
    return false;
  }, { timeout: 20_000 }).toBe(true);
  return found;
}
async function recordBest(p: Page) {
  await expect(async () => {
    const pick = p.getByRole("group", { name: "추천 점수 바로 기록" }).getByRole("button").first();
    if (await pick.isVisible()) await pick.click();
    else {
      await p.locator(".score-category-select, .score-option").first().click();
      const ok = p.getByRole("button", { name: "점수 기록 확정" });
      if (await ok.isVisible().catch(() => false)) await ok.click();
    }
    await expect(p.locator(".roll-button")).toContainText("님의 차례", { timeout: 2000 }); // recorded → the turn passed
  }).toPass({ timeout: 15_000 });
}

test("순차 3인(서로 다른 장착): 보드판·주사위 스킨이 현재 차례 플레이어 기준으로 모든 화면에 같고, 킵·해제·재굴림·턴 전환·새로고침에도 유지된다", async ({ browser }, info) => {
  test.skip(info.project.name === "mobile", "여러 기기를 한 테스트에서 직접 만든다");
  test.setTimeout(240_000);
  const keys = ["a", "b", "c"];
  const host = await device(browser, "a");
  await host.goto(entry());
  await host.getByRole("tab", { name: "친구 대전" }).click();
  await host.getByLabel("최대 인원").selectOption("3");
  await host.getByRole("button", { name: "방 만들기" }).click();
  await expect(host.getByRole("heading", { name: "대기실" })).toBeVisible();
  const code = (await host.getByLabel("초대 코드").textContent())!.trim();
  const pages = [host];
  for (const key of keys.slice(1)) {
    const g = await device(browser, key);
    await g.goto(entry(code));
    await g.getByRole("button", { name: "입장하기" }).click();
    await g.getByRole("button", { name: "준비 완료" }).click();
    pages.push(g);
  }
  await host.getByRole("button", { name: /게임 시작/ }).click();
  for (const p of pages) await expect(p.locator(".roll-button")).toBeVisible({ timeout: 15_000 });

  for (let turn = 0; turn < 6; turn++) {
    const idx = await turnPage(pages);
    const owner = keys[idx];
    await expectTable(pages, owner); // every screen: the player on turn
    await pages[idx].locator(".roll-button").click();
    await expect(pages[idx].locator(".board-top b")).toHaveText("1");
    await expectTable(pages, owner);
    // keep one die, check; release it, check; keep again and re-roll, check
    const die = pages[idx].locator(".die-hit, .die-button").first();
    await die.click();
    await expect(die).toHaveAttribute("aria-pressed", "true");
    await expectTable(pages, owner);
    if (process.env.A2_SHOTS3D) { await pages[idx].waitForTimeout(1200); await pages[idx].screenshot({ path: `/tmp/claude-0/keep3d-t${turn}-owner.png` }); await pages[(idx + 1) % 3].screenshot({ path: `/tmp/claude-0/keep3d-t${turn}-other.png` }); }
    await die.click();
    await expect(die).toHaveAttribute("aria-pressed", "false");
    await expectTable(pages, owner);
    await die.click();
    await pages[idx].locator(".roll-button").click();
    await expect(pages[idx].locator(".board-top b")).toHaveText("2");
    await expectTable(pages, owner);
    if (turn === 1) {
      // a watcher reloads in the middle of someone else's turn: the table is still that player's
      const other = (idx + 1) % 3;
      await pages[other].reload();
      await expect(pages[other].locator(".roll-button")).toBeVisible({ timeout: 15_000 });
      await expectTable([pages[other]], owner);
    }
    await recordBest(pages[idx]);
  }
});

test("순차 2인(빠른 대전): 상대 차례에는 상대의 보드판·주사위, 내 차례에는 내 것이 양쪽 화면에 같다", async ({ browser }, info) => {
  test.skip(info.project.name === "mobile", "두 기기를 한 테스트에서 직접 만든다");
  test.setTimeout(180_000);
  const keys = ["b", "c"];
  const pages = [await device(browser, "b"), await device(browser, "c")];
  for (const p of pages) { await p.goto(entry()); await p.getByRole("button", { name: "빠른 대전 시작" }).click(); }
  for (const p of pages) await expect(p.locator(".roll-button")).toBeVisible({ timeout: 20_000 });
  for (let turn = 0; turn < 4; turn++) {
    const idx = await turnPage(pages);
    await expectTable(pages, keys[idx]);
    await pages[idx].locator(".roll-button").click();
    await expect(pages[idx].locator(".roll-button")).toContainText("다시 굴리기");
    const die = pages[idx].locator(".die-hit, .die-button").first();
    await die.click();
    await expect(die).toHaveAttribute("aria-pressed", "true");
    await expectTable(pages, keys[idx]);
    await recordBest(pages[idx]);
  }
});

test("동시 4인(회원 3 + 게스트 1): 각자 자기 보드판·주사위 스킨을 보고, 킵·해제·재굴림·새로고침 뒤에도 바뀌지 않는다", async ({ browser }, info) => {
  test.skip(info.project.name === "mobile", "여러 기기를 한 테스트에서 직접 만든다");
  test.setTimeout(240_000);
  const keys = ["a", "b", "c", null];
  const host = await device(browser, "a");
  await host.goto(entry());
  await host.getByRole("tab", { name: "친구 대전" }).click();
  await host.getByLabel("최대 인원").selectOption("4");
  await host.getByRole("button", { name: "방 만들기" }).click();
  await expect(host.getByRole("heading", { name: "대기실" })).toBeVisible();
  const code = (await host.getByLabel("초대 코드").textContent())!.trim();
  const pages = [host];
  for (const key of keys.slice(1)) {
    const g = await device(browser, key);
    await g.goto(entry(code));
    if (!key) await g.evaluate(() => { localStorage.setItem("yachtlab.online.name", "게스트"); window.dispatchEvent(new Event("yachtlab-nickname")); });
    await g.getByRole("button", { name: "입장하기" }).click();
    await g.getByRole("button", { name: "준비 완료" }).click();
    pages.push(g);
  }
  await host.getByText("동시 진행").click();
  await host.getByRole("button", { name: /게임 시작/ }).click();
  for (const p of pages) await expect(p.locator(".roll-button")).toBeEnabled({ timeout: 15_000 });
  const own = async (i: number) => {
    const k = keys[i];
    if (k) await expectTable([pages[i]], k);
    else expect(await tableOf(pages[i])).toEqual({ board: "var(--table)", dice: process.env.A2_DICE === "3d" ? "-" : expect.any(String) });
  };
  for (const [i, p] of pages.entries()) {
    await own(i);
    await p.locator(".roll-button").click();
    await expect(p.locator(".board-top b")).toHaveText("1");
    const die = p.locator(".die-hit, .die-button").first();
    await die.click();
    await expect(die).toHaveAttribute("aria-pressed", "true");
    await own(i);
    if (process.env.A2_SHOTS3D) { await p.waitForTimeout(1200); await p.screenshot({ path: `/tmp/claude-0/sim3d-${i}.png` }); }
    await die.click();
    await own(i);
    await die.click();
    await p.locator(".roll-button").click();
    await expect(p.locator(".board-top b")).toHaveText("2");
    await own(i);
  }
  await pages[1].reload();
  await expect(pages[1].locator(".roll-button")).toBeVisible({ timeout: 15_000 });
  await own(1);
});

/** The score sheet of a real 2/3/4-player room: every player column visible, no scroll, 12 rows + bonus + total in one screen. */
for (const players of [2, 3, 4]) {
  test(`${players}인 온라인 점수판: 참가자 열이 잘리지 않고 스크롤 없이 12족보·보너스·총점이 한 화면에 보인다 (1366×768 / 1280×720)`, async ({ browser }, info) => {
    test.skip(info.project.name === "mobile", "desktop layout");
    test.setTimeout(150_000);
    const keys = ["a", "b", "c", null].slice(0, players);
    const host = await device(browser, "a", { width: 1280, height: 720 });
    await host.goto(entry());
    await host.getByRole("tab", { name: "친구 대전" }).click();
    if (players > 2) await host.getByLabel("최대 인원").selectOption(String(players));
    await host.getByRole("button", { name: "방 만들기" }).click();
    await expect(host.getByRole("heading", { name: "대기실" })).toBeVisible();
    const code = (await host.getByLabel("초대 코드").textContent())!.trim();
    const pages = [host];
    for (const key of keys.slice(1)) {
      const g = await device(browser, key, { width: 1366, height: 768 });
      await g.goto(entry(code));
      if (!key) await g.evaluate(() => { localStorage.setItem("yachtlab.online.name", "아주아주긴닉네임을가진게스트플레이어"); window.dispatchEvent(new Event("yachtlab-nickname")); });
      await g.getByRole("button", { name: "입장하기" }).click();
      if (players > 2) await g.getByRole("button", { name: "준비 완료" }).click();
      pages.push(g);
    }
    await host.getByRole("button", { name: /게임 시작/ }).click();
    for (const p of pages) await expect(p.locator(".scoreboard")).toBeVisible({ timeout: 15_000 });
    for (const p of pages) {
      const m = await p.evaluate(() => {
        const sb = document.querySelector(".scoreboard") as HTMLElement;
        const r = sb.getBoundingClientRect();
        const heads = [...sb.querySelectorAll("thead th")].map((th) => th.getBoundingClientRect());
        const scroller = sb.querySelector(".multi-score-scroll") as HTMLElement | null;
        const rows = sb.querySelectorAll("tr[data-category]").length;
        const total = sb.querySelector(".total-row")!.getBoundingClientRect();
        const names = [...sb.querySelectorAll("thead th .col-name")].map((n) => ({ text: n.textContent, clipped: (n as HTMLElement).scrollWidth > (n as HTMLElement).clientWidth, title: n.parentElement?.getAttribute("title") }));
        return {
          vw: innerWidth, vh: innerHeight, left: r.left, right: r.right, top: r.top + scrollY, totalBottom: total.bottom + scrollY,
          headsInside: heads.every((h) => h.left >= r.left - 1 && h.right <= r.right + 1 && h.width > 30),
          xScroll: scroller ? scroller.scrollWidth - scroller.clientWidth : 0, yScroll: scroller ? scroller.scrollHeight - scroller.clientHeight : 0,
          docX: document.documentElement.scrollWidth - innerWidth, docY: document.documentElement.scrollHeight - innerHeight,
          rows, columns: heads.length - 1, names,
        };
      });
      expect(m.columns).toBe(players);
      expect(m.rows).toBe(12);
      expect(m.headsInside).toBe(true);
      expect(m.right).toBeLessThanOrEqual(m.vw);
      expect(m.xScroll).toBeLessThanOrEqual(1);
      expect(m.yScroll).toBeLessThanOrEqual(1);
      expect(m.docX).toBeLessThanOrEqual(1);
      expect(m.top).toBeLessThan(100); // the sheet starts at the content top
      expect(m.totalBottom).toBeLessThanOrEqual(m.vh); // page coordinates: the total row is on screen without scrolling
      for (const n of m.names) expect(n.title).toBe(n.text); // full name stays readable (tooltip) when ellipsized
    }
    if (players === 4) await pages[0].screenshot({ path: "docs/ui/a2-2026-11/after/online-4p-scoreboard-1280x720.png" });
    if (players === 4) await pages[3].screenshot({ path: "docs/ui/a2-2026-11/after/online-4p-scoreboard-1366x768.png" });
  });
}

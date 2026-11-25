import { returningVisitorState } from "./visitor";
import {
  expect,
  test,
  devices,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  startOnlineServer,
  type RunningOnlineServer,
} from "../../server/online/server";
import { startLocalWorker } from "../helpers/wrangler";
import { scoreCategory, nick } from "./helpers";

/**
 * Online play with two separate browser contexts (= two devices with their own storage), against both
 * server backends started by this file:
 *  - "node":    the Phase 2 local Node server (server/online)
 *  - "workers": the Phase 3 Cloudflare Worker + SQLite Durable Objects under `wrangler dev --local`
 * Nothing external is contacted and nothing is deployed.
 */
type Backend = { url: string; restart(): Promise<void>; stop(): Promise<void> };
const ORIGINS = ["http://127.0.0.1:5173"];
const backends: Partial<Record<"node" | "workers", Backend>> = {};
let active: Backend;

async function nodeBackend(): Promise<Backend> {
  const dataDir = await mkdtemp(join(tmpdir(), "yachtlab-online-ui-"));
  let server: RunningOnlineServer = await startOnlineServer({
    port: 0,
    dataDir,
    allowedOrigins: ORIGINS,
    turnTimeoutMs: null,
  });
  const backend: Backend = {
    url: server.url,
    async restart() {
      const port = server.port;
      await server.close();
      await new Promise((r) => setTimeout(r, 2000)); // clients notice the outage
      server = await startOnlineServer({
        port,
        dataDir,
        allowedOrigins: ORIGINS,
        turnTimeoutMs: null,
      });
    },
    stop: () => server.close(),
  };
  return backend;
}

test.beforeAll(async ({}, testInfo) => {
  if (testInfo.project.name === "mobile") return; // two-device tests run once, in the desktop project
  test.setTimeout(120_000);
  backends.node = await nodeBackend();
  const worker = await startLocalWorker({
    ALLOWED_ORIGINS: ORIGINS.join(","),
    TURN_TIMEOUT_MS: "0",
    CREATE_PER_MINUTE: "500",
    JOIN_PER_MINUTE: "500",
  });
  backends.workers = {
    url: worker.url,
    restart: async () => {
      await worker.stop();
      await new Promise((r) => setTimeout(r, 2000));
      await worker.restart();
    },
    stop: worker.stop,
  };
});
test.afterAll(async () => {
  await Promise.all(Object.values(backends).map((b) => b?.stop()));
});
/** Browser contexts made by a test are closed after it, so no page keeps sockets open into later tests. */
const contexts: BrowserContext[] = [];
test.afterEach(async () => {
  await Promise.all(contexts.splice(0).map((c) => c.close().catch(() => undefined)));
});

const entry = (room?: string) =>
  `?online-server=${encodeURIComponent(active.url)}${room ? `&room=${room}` : ""}#online`;

/** Online entry on the 친구 대전 tab (servers with quick match open on 빠른 대전). */
async function openFriend(p: Page) {
  await p.goto(entry());
  const friend = p.getByRole("tab", { name: "친구 대전" });
  await expect(p.getByRole("button", { name: "방 만들기" }).or(friend)).toBeVisible();
  if (await friend.count()) await friend.click();
}

async function device(browser: Browser, kind: "desktop" | "phone") {
  const context = await browser.newContext({ storageState: returningVisitorState(),
    ...(kind === "phone"
      ? devices["Pixel 7"]
      : { viewport: { width: 1280, height: 900 } }),
    baseURL: "http://127.0.0.1:5173/YachtLab/",
    reducedMotion: "reduce",
  });
  contexts.push(context);
  return context.newPage();
}

async function createAndJoin(browser: Browser) {
  const a = await device(browser, "desktop");
  const b = await device(browser, "phone");
  await openFriend(a);
  await nick(a, "민수");
  await a.getByRole("button", { name: "방 만들기" }).click();
  await expect(a.getByRole("heading", { name: "대기실" })).toBeVisible();
  const code = (await a.getByLabel("초대 코드").textContent())!.trim();
  expect(code).toMatch(/^[A-Z2-9]{6}$/);
  // The invite link opens a join screen for exactly that room (no code to type) and shows whose room it is.
  await b.goto(entry(code));
  await expect(b.getByText("민수 님의 방에 초대받았어요")).toBeVisible();
  await expect(b.getByText(`초대 코드 ${code}`)).toBeVisible();
  await expect(b.getByLabel("초대 코드")).toHaveCount(0);
  await nick(b, "지민");
  await b.getByRole("button", { name: "입장하기" }).click();
  await expect(
    b.getByText("방장이 게임을 시작하면 바로 시작돼요."),
  ).toBeVisible();
  await expect(a.getByRole("list", { name: "참가자" })).toContainText("지민");
  return { a, b, code };
}

/** Whoever has an enabled roll button plays one turn (roll → score the first open category). */
async function playTurn(pages: Page[]) {
  let current: Page | null = null;
  await expect(async () => {
    for (const p of pages)
      if (await p.locator(".roll-button:not(.waiting):enabled").count())
        current = p;
    expect(current).not.toBeNull();
  }).toPass({ timeout: 10000 });
  const page = current!;
  await page.locator(".roll-button").click();
  await expect(page.locator(".turn-indicator")).toContainText("나의 차례");
  await expect(page.locator(".board-top b")).toHaveText("1");
  await scoreCategory(page);
  await expect(page.locator(".roll-button.waiting")).toBeVisible();
}

for (const kind of ["node", "workers"] as const) {
  test.describe(
    kind === "node"
      ? "로컬 Node 서버"
      : "Workers + Durable Objects (wrangler dev)",
    () => {
      test.beforeEach(({}, testInfo) => {
        if (testInfo.project.name !== "mobile") active = backends[kind]!;
      });

      test("두 브라우저가 초대 코드로 입장해 실시간으로 12라운드를 완주한다(고정·재굴림·점수·종료)", async ({
        browser,
      }, testInfo) => {
        test.skip(
          testInfo.project.name === "mobile",
          "두 기기(데스크톱+모바일)를 한 테스트에서 직접 만든다",
        );
        test.setTimeout(180_000);
        const { a, b } = await createAndJoin(browser);
        await expect(b.getByRole("button", { name: "게임 시작" })).toHaveCount(
          0,
        );
        await a.getByRole("button", { name: "게임 시작" }).click();
        await expect(a.locator(".turn-indicator")).toContainText("나의 차례");
        await expect(b.locator(".roll-button")).toContainText("민수 님의 차례");
        await expect(b.locator(".roll-button")).toBeDisabled();

        // Turn 1: roll, hold the first die (opponent sees the hold live), re-roll: the held die keeps its value.
        await a.locator(".roll-button").click();
        await expect(a.locator(".board-top b")).toHaveText("1");
        const die = a.locator(".die-button").first();
        await expect(die).toBeVisible();
        const firstValue = (await die.getAttribute("aria-label"))!.split(
          ", ",
        )[1];
        await expect(b.locator(".board-top b")).toHaveText("1");
        const opponentDice = await b
          .locator(".die-button")
          .evaluateAll((els) =>
            els.map((e) => e.getAttribute("aria-label")!.split(", ")[1]),
          );
        await die.click();
        await expect(die).toHaveAttribute("aria-pressed", "true");
        await expect(b.locator(".die-button").first()).toHaveAttribute(
          "aria-pressed",
          "true",
        );
        expect(opponentDice[0]).toBe(firstValue);
        await a.locator(".roll-button").click();
        await expect(a.locator(".board-top b")).toHaveText("2");
        await expect(a.locator(".die-button").first()).toHaveAttribute(
          "aria-label",
          new RegExp(`, ${firstValue}, 고정됨`),
        );
        await expect(b.locator(".board-top b")).toHaveText("2");
        // Both screens show the same dice, decided by the server.
        const shown = async (p: Page) =>
          p
            .locator(".die-button")
            .evaluateAll((els) =>
              els
                .map((e) => e.getAttribute("aria-label")!.split(", ")[1])
                .sort(),
            );
        expect(await shown(b)).toEqual(await shown(a));
        await a
          .locator('.scoreboard [data-category="choice"] .score-option')
          .click();
        await expect(b.locator(".game-feedback")).toContainText(
          "민수 · 초이스",
        );
        await expect(b.locator(".roll-button")).toBeEnabled();

        for (let turn = 1; turn < 24; turn++) await playTurn([a, b]);

        for (const p of [a, b])
          await expect(p.locator(".game-result")).toBeVisible();
        const scoreA = (await a.locator(".game-result .online-final").textContent())!
          .split(":")
          .map((s) => Number(s.trim()));
        const scoreB = (await b.locator(".game-result .online-final").textContent())!
          .split(":")
          .map((s) => Number(s.trim()));
        expect(scoreB).toEqual([scoreA[1], scoreA[0]]);
        await expect(a.locator(".score-summary [data-seat]")).toHaveCount(2);
        expect(
          await a
            .locator(".score-summary [data-seat='0'] strong")
            .textContent(),
        ).toContain(String(scoreA[0]));

        for (const p of [a, b]) await p.getByRole("button", { name: "결과 닫기" }).click();
        await expect(a.locator(".scoreboard")).toBeVisible();
        // Emote and preset chat after the match: shown live under the board on both screens; hiding the
        // other players' messages works (and the feed says so); free text cannot be typed.
        await a.getByRole("button", { name: "채팅·이모티콘" }).click();
        await expect(a.getByRole("dialog", { name: "채팅·이모티콘" }).locator("input[type=text], textarea")).toHaveCount(0);
        await a.getByRole("dialog", { name: "채팅·이모티콘" }).getByRole("button", { name: "박수" }).click();
        await expect(b.locator(".table-feed .feed-msg:not(.mine) .feed-text")).toHaveText("👏");
        await expect(a.locator(".table-feed .feed-msg.mine .feed-text")).toHaveText("👏");
        await b.getByRole("button", { name: "채팅·이모티콘" }).click();
        await b.getByLabel("다른 사람 메시지 숨기기").check();
        await b.keyboard.press("Escape");
        await a.waitForTimeout(1600);
        await a.getByRole("button", { name: "채팅·이모티콘" }).click();
        await a.getByRole("button", { name: "좋은 경기였어요!" }).click();
        await expect(a.locator(".table-feed .feed-msg.mine .feed-text").first()).toHaveText("좋은 경기였어요!");
        await expect(b.locator(".table-feed .feed-msg:not(.mine)")).toHaveCount(0, { timeout: 6000 });
        await expect(b.locator(".feed-hidden")).toBeVisible();

        // Rematch: request → the other screen is asked (also after a reload) → accept → a new match in the
        // same room, the other player moves first, scores start from 0.
        await a.getByRole("button", { name: "경기 결과", exact: true }).click();
        await a.getByRole("button", { name: "한 번 더 플레이", exact: true }).click();
        await expect(a.getByText("지민 님의 응답을 기다리는 중…")).toBeVisible();
        await b.getByRole("button", { name: "경기 결과 · 재대결 요청" }).click();
        await expect(b.getByText("민수 님이 재대결을 요청했어요.")).toBeVisible();
        await b.reload();
        await expect(b.getByText("민수 님이 재대결을 요청했어요.")).toBeVisible();
        await b.getByRole("button", { name: "수락" }).click();
        for (const p of [a, b]) await expect(p.locator(".game-result")).toHaveCount(0);
        await expect(b.locator(".turn-indicator")).toContainText("나의 차례");
        await expect(a.locator(".roll-button")).toContainText("지민 님의 차례");
        for (const p of [a, b]) await expect(p.locator(".score-summary [data-seat] strong").first()).toContainText("0");
        await b.locator(".roll-button").click();
        await expect(a.locator(".board-top b")).toHaveText("1");
      });

      test("관전: 두 플레이어 동의 후 링크로 읽기 전용 관전, 새로고침 유지, 동의 철회 시 종료·링크 무효", async ({ browser }, testInfo) => {
        test.skip(testInfo.project.name === "mobile", "두 기기를 직접 만든다");
        test.setTimeout(120_000);
        const { a, b } = await createAndJoin(browser);
        await a.getByRole("button", { name: "관전 설정" }).click();
        await a.getByRole("switch").check();
        await expect(a.getByText("상대도 관전을 허용하면 관전 링크가 만들어져요.")).toBeVisible();
        await b.getByRole("button", { name: "관전 설정" }).click();
        await b.getByRole("switch").check();
        const link = await a.getByLabel("관전 링크").inputValue();
        expect(link).toContain("watch=");
        expect(link).not.toContain("room=");
        await a.keyboard.press("Escape");
        await a.locator("h1").click();
        await a.getByRole("button", { name: "게임 시작" }).click();
        const w = await device(browser, "phone");
        await w.goto(link);
        await expect(w.getByText(/관전 중/)).toBeVisible();
        await expect(w.locator(".score-summary")).toContainText("민수");
        await expect(w.locator(".score-summary")).toContainText("지민");
        // read-only: no roll button, no score options, no chat button
        await expect(w.locator(".roll-button")).toHaveCount(0);
        await expect(w.locator(".score-option")).toHaveCount(0);
        await expect(w.getByRole("button", { name: "채팅·이모티콘" })).toHaveCount(0);
        await a.locator(".roll-button").click();
        await expect(w.locator(".board-top b")).toHaveText("1");
        const dice = async (p: Page) => p.locator(".die-button").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")!.split(", ")[1]).sort());
        await expect.poll(() => dice(w)).toEqual(await dice(a));
        await w.reload();
        await expect(w.locator(".board-top b")).toHaveText("1");
        await expect(a.getByRole("button", { name: "관전 설정" })).toContainText("관전 1");
        // b withdraws consent: the spectator is disconnected and the old link stops working
        await b.getByRole("button", { name: "관전 설정" }).click();
        await b.getByRole("switch").uncheck();
        await expect(w.getByText(/관전이 종료되었어요/)).toBeVisible();
        await w.goto(link);
        await expect(w.getByText(/관전이 종료되었어요/)).toBeVisible();
      });

      test("통합: 초대·관전·채팅·12라운드(중간 새로고침)·종료·기기 기록·재대결·두 번째 경기 기록 분리", async ({ browser }, testInfo) => {
        test.skip(testInfo.project.name === "mobile", "세 기기를 직접 만든다");
        test.setTimeout(240_000);
        const { a, b } = await createAndJoin(browser);
        for (const p of [a, b]) {
          await p.getByRole("button", { name: "관전 설정" }).click();
          await p.getByRole("switch").check();
        }
        const link = await b.getByLabel("관전 링크").inputValue();
        for (const p of [a, b]) await p.keyboard.press("Escape");
        await a.locator("h1").click();
        await a.getByRole("button", { name: "게임 시작" }).click();
        const w = await device(browser, "phone");
        await w.goto(link);
        await expect(w.getByText(/관전 중/)).toBeVisible();
        await a.getByRole("button", { name: "채팅·이모티콘" }).click();
        await a.getByRole("button", { name: "잘 부탁해요!" }).click();
        await expect(b.locator(".table-feed .feed-text")).toHaveText("잘 부탁해요!");
        await expect(w.locator(".table-feed .feed-text")).toHaveText("잘 부탁해요!");
        for (let turn = 0; turn < 24; turn++) {
          if (turn === 7) {
            await b.reload();
            await expect(b.locator(".score-summary")).toBeVisible();
          }
          await playTurn([a, b]);
        }
        for (const p of [a, b, w]) await expect(p.locator(".game-result")).toBeVisible();
        const records = (p: Page) => p.evaluate(() => JSON.parse(localStorage.getItem("yachtlab.records.v1") ?? "[]") as { recordId: string; mode: string; verification: string; score: number }[]);
        const first = await records(a);
        expect(first).toHaveLength(1);
        expect(first[0]).toMatchObject({ mode: "online", verification: "client-reported" });
        expect((await records(b))[0].recordId).toBe(first[0].recordId);
        await a.getByRole("button", { name: "한 번 더 플레이", exact: true }).click();
        await b.getByRole("button", { name: "수락" }).click();
        await expect(b.locator(".turn-indicator")).toContainText("나의 차례");
        await expect(w.locator(".game-result")).toHaveCount(0);
        for (let turn = 0; turn < 24; turn++) await playTurn([a, b]);
        for (const p of [a, b, w]) await expect(p.locator(".game-result")).toBeVisible();
        const second = await records(a);
        expect(second).toHaveLength(2);
        expect(second[0].recordId).not.toBe(second[1].recordId);
        await expect(a.locator(".online-series")).toContainText("이 방 전적");
        await a.getByRole("button", { name: "결과 닫기" }).click();
        await a.goto("#profile");
        await expect(a.locator(".profile-recent li")).toHaveCount(2);
      });

      test("새로고침·재접속·연결 끊김 후에도 같은 좌석으로 돌아와 경기를 이어간다", async ({
        browser,
      }, testInfo) => {
        test.skip(
          testInfo.project.name === "mobile",
          "두 기기를 한 테스트에서 직접 만든다",
        );
        test.setTimeout(90_000);
        const { a, b, code } = await createAndJoin(browser);
        await a.getByRole("button", { name: "게임 시작" }).click();
        await a.locator(".roll-button").click();
        await expect(a.locator(".board-top b")).toHaveText("1");

        // Refresh mid-turn: the seat comes back from this browser's storage (the token is never in the URL).
        expect(a.url()).not.toMatch(/token/i);
        await a.reload();
        await expect(a.locator(".turn-indicator")).toContainText("나의 차례");
        await expect(a.locator(".board-top b")).toHaveText("1");
        await expect(a.locator(".roll-button")).toBeEnabled();

        // The opponent's tab goes away (closed app / lost network): the other side is told, play continues,
        // and the same device rejoins its seat by opening the invite link again.
        await b.close();
        // Workers: a countdown of the reconnect grace (D-046); Node dev server: the plain notice.
        await expect(a.getByText(/지민 님(의)? 연결이? 끊/)).toBeVisible({
          timeout: 15000,
        });
        if (kind === "workers") await expect(a.getByText(/안에 돌아오지 않으면 기권 처리돼요/)).toBeVisible();
        await a
          .locator('.scoreboard [data-category="choice"] .score-option')
          .click();
        await expect(a.locator(".roll-button.waiting")).toBeVisible();
        // A brand-new tab with the invite link goes straight back to the saved seat.
        const again = await b.context().newPage();
        await again.goto(entry(code));
        await expect(again.locator(".roll-button")).toBeEnabled();
        await expect(a.getByText(/지민 님(의)? 연결이? 끊/)).toHaveCount(0);
        await expect(
          again.locator(".score-summary [data-seat='0'] strong"),
        ).not.toHaveText(/^0/);
        await again.locator(".roll-button").click();
        await expect(a.locator(".board-top b")).toHaveText("1");

        // Someone else with only the code cannot take a seat.
        const stranger = await device(browser, "desktop");
        await stranger.goto(entry(code));
        await expect(stranger.getByRole("alert")).toContainText("이미 경기가 진행 중인 방이에요");
        await expect(stranger.getByRole("button", { name: "입장하기" })).toHaveCount(0);
      });

      test("서버 재시작 후에도 저장된 경기가 복구되어 두 사람이 이어서 플레이한다", async ({
        browser,
      }, testInfo) => {
        test.skip(
          testInfo.project.name === "mobile",
          "두 기기를 한 테스트에서 직접 만든다",
        );
        test.setTimeout(90_000);
        const { a, b } = await createAndJoin(browser);
        await a.getByRole("button", { name: "게임 시작" }).click();
        await a.locator(".roll-button").click();
        await a
          .locator('.scoreboard [data-category="choice"] .score-option')
          .click();
        await expect(b.locator(".roll-button")).toBeEnabled();
        const restarted = active.restart();
        await expect(
          a.getByText("연결이 끊어졌어요. 다시 연결하는 중이에요"),
        ).toBeVisible({ timeout: 15000 });
        await restarted;
        await expect(b.locator(".roll-button")).toBeEnabled({ timeout: 20000 });
        await b.locator(".roll-button").click();
        await expect(a.locator(".board-top b")).toHaveText("1");
        await expect(
          a.locator(".score-summary [data-seat='0'] strong"),
        ).not.toHaveText(/^0/);
      });

      test("대기실: 닉네임 충돌 안내, 방장 나가기 후 승계, 없는 코드 안내", async ({
        browser,
      }, testInfo) => {
        test.skip(
          testInfo.project.name === "mobile",
          "두 기기를 한 테스트에서 직접 만든다",
        );
        const a = await device(browser, "desktop");
        const b = await device(browser, "phone");
        await openFriend(a);
        await nick(a, "하늘");
        await a.getByRole("button", { name: "방 만들기" }).click();
        await expect(a.getByRole("heading", { name: "대기실" })).toBeVisible();
        const code = (await a.getByLabel("초대 코드").textContent())!.trim();
        await b.goto(entry(code));
        // the same nickname in one room: the server numbers it instead of refusing
        await nick(b, "하늘");
        await b.getByRole("button", { name: "입장하기" }).click();
        await expect(a.getByRole("list", { name: "참가자" })).toContainText(
          "하늘 2",
        );
        await a.getByRole("button", { name: "방 나가기" }).click();
        await expect(
          a.getByRole("heading", { name: "온라인 대전" }),
        ).toBeVisible();
        await expect(
          b.getByRole("button", { name: "게임 시작" }),
        ).toBeVisible();
        await expect(b.getByRole("list", { name: "참가자" })).not.toContainText(
          /하늘(?! 2)/,
        );
        const c = await device(browser, "desktop");
        await openFriend(c);
        await nick(c, "손님");
        await c.getByLabel("초대 코드").fill("ZZZZZZ");
        await c.getByRole("button", { name: "입장하기" }).click();
        await expect(c.getByRole("alert")).toContainText("방을 찾을 수 없어요");
      });

      test("초대 링크로 바로 입장: 코드 입력 없이 저장된 닉네임으로 입장, #가 빠진 링크도 동작, 입장할 수 없는 방 안내", async ({
        browser,
      }, testInfo) => {
        test.skip(
          testInfo.project.name === "mobile",
          "두 기기를 한 테스트에서 직접 만든다",
        );
        const a = await device(browser, "desktop");
        const b = await device(browser, "phone");
        await openFriend(a);
        await nick(a, "초대자");
        await a.getByRole("button", { name: "방 만들기" }).click();
        await expect(a.getByRole("heading", { name: "대기실" })).toBeVisible();
        // the waiting room shows the full link (for in-app browsers without clipboard access)
        const link = await a.getByLabel("초대 링크").inputValue();
        const code = (await a.getByLabel("초대 코드").textContent())!.trim();
        expect(link).toContain(`room=${code}`);
        expect(link).not.toMatch(/token/i);
        // B has played before (saved nickname) and opens the link with the #online part missing
        await b.goto(entry());
        await b.evaluate(() => localStorage.setItem("yachtlab.online.name", "예전닉"));
        await b.goto(`?online-server=${encodeURIComponent(active.url)}&room=${code}`);
        await expect(b.getByText("초대자 님의 방에 초대받았어요")).toBeVisible();
        // no nickname field on the invite screen: the saved one is used (changed on the profile page)
        await expect(b.getByLabel("닉네임")).toHaveCount(0);
        await expect(b.locator(".online-nick")).toContainText("예전닉");
        await b.getByRole("button", { name: "입장하기" }).click();
        await expect(b.getByText("방장이 게임을 시작하면 바로 시작돼요.")).toBeVisible();
        await expect(a.getByRole("list", { name: "참가자" })).toContainText("예전닉");
        // refreshing the link afterwards goes straight back to the seat
        await b.reload();
        await expect(b.getByText("방장이 게임을 시작하면 바로 시작돼요.")).toBeVisible();
        // a third browser: full room, then in progress; an unknown code says the room is gone
        const c = await device(browser, "desktop");
        await c.goto(entry(code));
        await expect(c.getByRole("alert")).toContainText("이미 두 명이 모두 들어온 방이에요");
        await a.getByRole("button", { name: "게임 시작" }).click();
        await c.reload();
        await expect(c.getByRole("alert")).toContainText("이미 경기가 진행 중인 방이에요");
        await c.goto(entry("ZZZZZZ"));
        await expect(c.getByRole("alert")).toContainText("방을 찾을 수 없어요");
        // the code form is still there for people who prefer typing the code
        await c.getByRole("button", { name: /코드로 입장/ }).click();
        await expect(c.getByLabel("초대 코드")).toBeVisible();
      });

      test("두 화면의 주사위 상태(값·ID·고정·고정 순서·표시 순서·굴림 횟수)가 매 굴림·고정 후, 새로고침 후에도 같다", async ({
        browser,
      }, testInfo) => {
        test.skip(
          testInfo.project.name === "mobile",
          "두 기기를 한 테스트에서 직접 만든다",
        );
        test.setTimeout(120_000);
        const { a, b } = await createAndJoin(browser);
        await a.getByRole("button", { name: "게임 시작" }).click();
        /** What a screen shows: rolls, the dice row (id, value, held) in display order, and the shelf order. */
        const shown = (p: Page) =>
          p.evaluate(() => ({
            rolls: document.querySelector(".board-top b")?.textContent ?? "",
            dice: [...document.querySelectorAll(".game-board .die-button")].map((d) => d.getAttribute("aria-label")),
            holdOrder: document.querySelector<HTMLElement>("[data-hold-order]")?.dataset.holdOrder ?? null,
          }));
        const same = async (rolls: string, holdOrder: string) => {
          await expect(a.locator(".board-top b")).toHaveText(rolls);
          await expect(b.locator(".board-top b")).toHaveText(rolls);
          await expect(a.locator("[data-hold-order]")).toHaveAttribute("data-hold-order", holdOrder);
          await expect(b.locator("[data-hold-order]")).toHaveAttribute("data-hold-order", holdOrder);
          await expect.poll(async () => JSON.stringify(await shown(b))).toBe(JSON.stringify(await shown(a)));
        };
        const die = (p: Page, id: number) => p.locator(`.game-board .die-button[aria-label^="주사위 ${id + 1},"]`);
        // A's turn: roll, hold C(2) → A(0) → E(4)
        await a.locator(".roll-button").click();
        await same("1", "");
        for (const [id, order] of [
          [2, "2"],
          [0, "2,0"],
          [4, "2,0,4"],
        ] as const) {
          await die(a, id).click();
          await same("1", order);
        }
        const heldValues = await a.evaluate(() => [2, 0, 4].map((id) => document.querySelector(`.game-board .die-button[aria-label^="주사위 ${id + 1},"]`)!.getAttribute("aria-label")));
        // re-roll: the held dice keep value and order on both screens
        await a.locator(".roll-button").click();
        await same("2", "2,0,4");
        expect(await a.evaluate(() => [2, 0, 4].map((id) => document.querySelector(`.game-board .die-button[aria-label^="주사위 ${id + 1},"]`)!.getAttribute("aria-label")))).toEqual(heldValues);
        // release A(0): the rest keep their order; selecting it again puts it last
        await die(a, 0).click();
        await same("2", "2,4");
        await die(a, 0).click();
        await same("2", "2,4,0");
        // both screens refresh (reconnect): the same state comes back from the server
        await b.reload();
        await same("2", "2,4,0");
        await a.reload();
        await same("2", "2,4,0");
        // opponent's view after a score and turn change
        await a.locator('.scoreboard [data-category="choice"] .score-option').click();
        await expect(b.locator(".roll-button")).toBeEnabled();
        await b.locator(".roll-button").click();
        await same("1", "");
        await die(b, 3).click();
        await die(b, 1).click();
        await same("1", "3,1");
        await b.locator(".roll-button").click();
        await same("2", "3,1");
      });

      test("320px 화면에서도 온라인 입장·대기실·게임판이 가로로 넘치지 않는다", async ({
        browser,
      }, testInfo) => {
        test.skip(
          testInfo.project.name === "mobile" || kind !== "node",
          "레이아웃은 서버 종류와 무관: 데스크톱 프로젝트에서 한 번만",
        );
        const fits = (p: Page) =>
          p.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
        const narrow = async () => {
          const ctx = await browser.newContext({ storageState: returningVisitorState(),
            viewport: { width: 320, height: 740 },
            baseURL: "http://127.0.0.1:5173/YachtLab/",
            reducedMotion: "reduce",
          });
          contexts.push(ctx);
          return ctx.newPage();
        };
        const a = await narrow();
        const b = await narrow();
        await openFriend(a);
        expect(await fits(a)).toBe(true);
        await nick(a, "가나다라마바사아자차");
        await a.getByRole("button", { name: "방 만들기" }).click();
        await expect(a.getByRole("heading", { name: "대기실" })).toBeVisible();
        expect(await fits(a)).toBe(true);
        const code = (await a.getByLabel("초대 코드").textContent())!.trim();
        await b.goto(entry(code));
        expect(await fits(b)).toBe(true);
        // the widest 12-character Latin name still fits (the length policy itself is checked on the profile page)
        await nick(b, "WWWWWWWWWWWW");
        await b.getByRole("button", { name: "입장하기" }).click();
        await a.getByRole("button", { name: "게임 시작" }).click();
        await expect(b.locator(".roll-button")).toBeVisible();
        await a.locator(".roll-button").click();
        await expect(a.locator(".board-top b")).toHaveText("1");
        expect(await fits(a)).toBe(true);
        expect(await fits(b)).toBe(true);
      });
    },
  );
}

test("서버 주소가 없는 빌드는 온라인 서버에 연결되지 않았다고 안내한다", async ({
  page,
}) => {
  await page.goto("#online");
  await expect(
    page.getByRole("heading", { name: "온라인 서버에 연결되어 있지 않아요" }),
  ).toBeVisible();
  // A non-loopback server parameter is ignored (links cannot send players to a foreign server).
  await page.goto("?online-server=https://evil.example#online");
  await expect(
    page.getByRole("heading", { name: "온라인 서버에 연결되어 있지 않아요" }),
  ).toBeVisible();
});

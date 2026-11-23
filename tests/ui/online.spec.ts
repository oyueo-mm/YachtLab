import {
  expect,
  test,
  devices,
  type Browser,
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
import { scoreCategory } from "./helpers";

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

const entry = (room?: string) =>
  `?online-server=${encodeURIComponent(active.url)}${room ? `&room=${room}` : ""}#online`;

async function device(browser: Browser, kind: "desktop" | "phone") {
  const context = await browser.newContext({
    ...(kind === "phone"
      ? devices["Pixel 7"]
      : { viewport: { width: 1280, height: 900 } }),
    baseURL: "http://127.0.0.1:5173/YachtLab/",
    reducedMotion: "reduce",
  });
  return context.newPage();
}

async function createAndJoin(browser: Browser) {
  const a = await device(browser, "desktop");
  const b = await device(browser, "phone");
  await a.goto(entry());
  await a.getByLabel("닉네임").fill("민수");
  await a.getByRole("button", { name: "방 만들기" }).click();
  await expect(a.getByRole("heading", { name: "대기실" })).toBeVisible();
  const code = (await a.getByLabel("초대 코드").textContent())!.trim();
  expect(code).toMatch(/^[A-Z2-9]{6}$/);
  // The invite link opens the entry screen with the code filled in and shows whose room it is.
  await b.goto(entry(code));
  await expect(b.getByText("님의 방에 초대받았어요")).toBeVisible();
  await expect(b.getByLabel("초대 코드")).toHaveValue(code);
  await b.getByLabel("닉네임").fill("지민");
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
        const scoreA = (await a.locator(".game-result p").textContent())!
          .split(":")
          .map((s) => Number(s.trim()));
        const scoreB = (await b.locator(".game-result p").textContent())!
          .split(":")
          .map((s) => Number(s.trim()));
        expect(scoreB).toEqual([scoreA[1], scoreA[0]]);
        await expect(a.locator(".score-summary [data-seat]")).toHaveCount(2);
        expect(
          await a
            .locator(".score-summary [data-seat='0'] strong")
            .textContent(),
        ).toContain(String(scoreA[0]));
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
        await expect(a.getByText("지민 님의 연결이 끊어졌어요")).toBeVisible({
          timeout: 15000,
        });
        await a
          .locator('.scoreboard [data-category="choice"] .score-option')
          .click();
        await expect(a.locator(".roll-button.waiting")).toBeVisible();
        // A brand-new tab with the invite link goes straight back to the saved seat.
        const again = await b.context().newPage();
        await again.goto(entry(code));
        await expect(again.locator(".roll-button")).toBeEnabled();
        await expect(a.getByText("지민 님의 연결이 끊어졌어요")).toHaveCount(0);
        await expect(
          again.locator(".score-summary [data-seat='0'] strong"),
        ).not.toHaveText(/^0/);
        await again.locator(".roll-button").click();
        await expect(a.locator(".board-top b")).toHaveText("1");

        // Someone else with only the code cannot take a seat.
        const stranger = await device(browser, "desktop");
        await stranger.goto(entry(code));
        await stranger.getByLabel("닉네임").fill("도윤");
        await stranger.getByRole("button", { name: "입장하기" }).click();
        await expect(stranger.getByRole("alert")).toContainText("이미");
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
        await a.goto(entry());
        await a.getByLabel("닉네임").fill("하늘");
        await a.getByRole("button", { name: "방 만들기" }).click();
        await expect(a.getByRole("heading", { name: "대기실" })).toBeVisible();
        const code = (await a.getByLabel("초대 코드").textContent())!.trim();
        await b.goto(entry(code));
        await b.getByLabel("닉네임").fill("하늘");
        await b.getByRole("button", { name: "입장하기" }).click();
        await expect(b.getByRole("alert")).toContainText("같은 닉네임");
        await b.getByLabel("닉네임").fill("바다");
        await b.getByRole("button", { name: "입장하기" }).click();
        await expect(a.getByRole("list", { name: "참가자" })).toContainText(
          "바다",
        );
        await a.getByRole("button", { name: "방 나가기" }).click();
        await expect(
          a.getByRole("heading", { name: "온라인 대전" }),
        ).toBeVisible();
        await expect(
          b.getByRole("button", { name: "게임 시작" }),
        ).toBeVisible();
        await expect(b.getByRole("list", { name: "참가자" })).not.toContainText(
          "하늘",
        );
        const c = await device(browser, "desktop");
        await c.goto(entry());
        await c.getByLabel("닉네임").fill("손님");
        await c.getByLabel("초대 코드").fill("ZZZZZZ");
        await c.getByRole("button", { name: "입장하기" }).click();
        await expect(c.getByRole("alert")).toContainText("방을 찾을 수 없어요");
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
          const ctx = await browser.newContext({
            viewport: { width: 320, height: 740 },
            baseURL: "http://127.0.0.1:5173/YachtLab/",
            reducedMotion: "reduce",
          });
          return ctx.newPage();
        };
        const a = await narrow();
        const b = await narrow();
        await a.goto(entry());
        expect(await fits(a)).toBe(true);
        await a.getByLabel("닉네임").fill("가나다라마바사아자차");
        await a.getByRole("button", { name: "방 만들기" }).click();
        await expect(a.getByRole("heading", { name: "대기실" })).toBeVisible();
        expect(await fits(a)).toBe(true);
        const code = (await a.getByLabel("초대 코드").textContent())!.trim();
        await b.goto(entry(code));
        expect(await fits(b)).toBe(true);
        await b.getByLabel("닉네임").fill("ABCDEFGHIJKLMNOPQRSTUVWX");
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

test("서버가 설정되지 않은 배포본은 온라인 대전을 '준비 중'으로 안내한다", async ({
  page,
}) => {
  await page.goto("#online");
  await expect(
    page.getByRole("heading", { name: "온라인 대전은 준비 중이에요" }),
  ).toBeVisible();
  // A non-loopback server parameter is ignored (links cannot send players to a foreign server).
  await page.goto("?online-server=https://evil.example#online");
  await expect(
    page.getByRole("heading", { name: "온라인 대전은 준비 중이에요" }),
  ).toBeVisible();
});

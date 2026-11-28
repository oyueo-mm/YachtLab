import { returningVisitorState } from "./visitor";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { startLocalWorker, type LocalWorker } from "../helpers/wrangler";
import { fakeLogin, startFakeIdp, type FakeIdp } from "../helpers/fake-idp";
import { scoreCategory } from "./helpers";

/**
 * A3 §7 재현: 같은 친구 방에서 회원 두 명이 재대결로 두 경기를 연속으로 끝낸다(격리된 로컬 Worker, 가짜 로그인,
 * 실제 경제 원장). 서버 사실(API)과 화면 표시를 따로 기록해 "서버 저장 지연"과 "클라이언트 갱신 누락"을 구분한다.
 *
 * 아래의 "현재 동작" 단언은 Hotfix H-A3-1~3 이전의 실제 동작을 고정한 것이다. Hotfix가 들어오면 이 단언을
 * 기대 동작으로 바꾼다(문서 A3-MATCH-RESULT §7).
 */
let worker: LocalWorker;
let idp: FakeIdp;
const ORIGIN = "http://127.0.0.1:5173";
const contexts: BrowserContext[] = [];
test.beforeAll(async ({}, testInfo) => {
  if (testInfo.project.name === "mobile") return;
  test.setTimeout(120_000);
  idp = await startFakeIdp();
  worker = await startLocalWorker({ ALLOWED_ORIGINS: ORIGIN, TURN_TIMEOUT_MS: "0", CREATE_PER_MINUTE: "500", JOIN_PER_MINUTE: "500", GOOGLE_CLIENT_ID: "test-client", GOOGLE_CLIENT_SECRET: "test-secret", AUTH_SECRET: "s".repeat(40), APP_URL: ORIGIN + "/YachtLab/", TEST_OIDC_ISSUER: idp.issuer, ECONOMY: "on" });
});
test.afterEach(async () => {
  await Promise.all(contexts.splice(0).map((c) => c.close().catch(() => undefined)));
});
test.afterAll(async () => {
  await worker?.stop();
  idp?.close();
});

const at = (hash: string) => `?online-server=${encodeURIComponent(worker.url)}#${hash}`;
const api = async (session: string, path: string) => (await fetch(worker.url + path, { headers: { origin: ORIGIN, authorization: "Bearer " + session } })).json() as Promise<Record<string, any>>;

async function member(browser: Browser, sub: string, nickname: string) {
  const session = await fakeLogin(worker.url, idp, sub, ORIGIN);
  await fetch(worker.url + "/api/me/nickname", { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json", authorization: "Bearer " + session }, body: JSON.stringify({ nickname }) });
  const ctx = await browser.newContext({ storageState: returningVisitorState(), viewport: { width: 1280, height: 900 }, baseURL: ORIGIN + "/YachtLab/", reducedMotion: "reduce" });
  await ctx.addInitScript((s) => localStorage.setItem("yachtlab.session.v1", s), session);
  contexts.push(ctx);
  return { page: await ctx.newPage(), session };
}

async function playTurn(pages: Page[]) {
  let current: Page | null = null;
  await expect(async () => {
    for (const p of pages) if (await p.locator(".roll-button:not(.waiting):enabled").count()) current = p;
    expect(current).not.toBeNull();
  }).toPass({ timeout: 10_000 });
  const page = current!;
  await page.locator(".roll-button").click();
  await expect(page.locator(".board-top b")).toHaveText("1");
  await scoreCategory(page);
  await expect(page.locator(".roll-button.waiting")).toBeVisible();
}

const shownCoins = async (p: Page) => Number(((await p.getByTestId("coins").first().textContent()) ?? "").replace(/[^0-9]/g, "") || NaN);

test("재대결 두 경기: 서버는 즉시 저장, 방 안의 재화·퀘스트 표시와 홈 보상 알림은 갱신되지 않음(H-A3 재현)", async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "두 기기를 한 테스트에서 직접 만든다");
  test.setTimeout(300_000);
  const A = await member(browser, "a3-rematch-a", "가람");
  const B = await member(browser, "a3-rematch-b", "나래");
  const a = A.page, b = B.page;
  await a.goto(at("online"));
  const friendTab = a.getByRole("tab", { name: "친구 대전" });
  await expect(a.getByRole("button", { name: "방 만들기" }).or(friendTab)).toBeVisible();
  if (await friendTab.count()) await friendTab.click();
  await a.getByRole("button", { name: "방 만들기" }).click();
  const link = await a.getByLabel("초대 링크").inputValue();
  await b.goto(link.replace(/^https?:\/\/[^/]+\/YachtLab\//, ""));
  await b.getByRole("button", { name: "입장하기" }).click();
  await expect(a.getByRole("list", { name: "참가자" })).toContainText("나래");
  await expect(a.getByTestId("coins").first()).not.toHaveText("–");
  const start = { coins: await shownCoins(a), server: (await api(A.session, "/api/me/economy")).snapshot.wallet.coins as number };
  expect(start.coins).toBe(start.server);
  await a.getByRole("button", { name: "게임 시작" }).click();

  const observations: string[] = [];
  for (let game = 1; game <= 2; game++) {
    if (game === 2) {
      await a.getByRole("button", { name: "한 번 더 플레이", exact: true }).click();
      await expect(b.getByText("가람 님이 재대결을 요청했어요.")).toBeVisible();
      await b.getByRole("button", { name: "수락" }).click();
      for (const p of [a, b]) await expect(p.locator(".game-result")).toHaveCount(0);
    }
    for (let t = 0; t < 24; t++) await playTurn([a, b]);
    await expect(a.locator(".game-result")).toBeVisible({ timeout: 15_000 });
    const finishedAt = Date.now();

    // 1) 서버: 계정 기록과 보상 receipt가 언제 생기는가
    let records: any[] = [];
    await expect(async () => {
      records = (await api(A.session, "/api/me/records?limit=50")).records;
      expect(records.filter((r) => r.mode === "online")).toHaveLength(game);
    }).toPass({ timeout: 10_000 });
    const serverMs = Date.now() - finishedAt;
    const latest = records.find((r) => r.mode === "online")!;
    const receipt = (await api(A.session, `/api/me/records/${latest.recordId}/reward`)).receipt;
    const serverCoins = (await api(A.session, "/api/me/economy")).snapshot.wallet.coins as number;
    expect(receipt).toBeTruthy();
    expect(serverCoins).toBe(receipt.after.coins);

    // 방 전적(서버 방송)은 즉시 갱신된다
    if (game > 1) await expect(a.locator(".online-series")).toContainText("이 방 전적");
    // 2) 결과 창: 서버 receipt를 읽어 이번 경기 보상을 표시(정상)
    const gained = receipt.after.coins - receipt.before.coins;
    if (gained > 0) await expect(a.locator(".game-result")).toContainText(`+${gained}코인`);

    // 3) 방 안 상단 재화: 경기 후 다시 조회하지 않음 (H-A3-1, 현재 동작)
    await a.waitForTimeout(3000);
    const shown = await shownCoins(a);
    console.log(`[A3 rematch] game ${game}: server record after ≤${serverMs} ms, receipt +${gained}, quests ${JSON.stringify(receipt.quests)}, grants ${JSON.stringify(receipt.grants)}, server wallet ${serverCoins}, top bar ${shown}, server quest state ${JSON.stringify((await api(A.session, "/api/me/economy")).snapshot.state.daily)}`);
    observations.push(`game ${game}: server record after ≤${serverMs} ms, receipt +${gained} coins, server wallet ${serverCoins}, top bar ${shown}`);
    // A3_HOTFIX=1: OnlineGame에 useAccountRefreshAfterMatch를 연결한 검증 실행(H-A3-1 적용 후 기대 동작).
    if (process.env.A3_HOTFIX) await expect.poll(() => shownCoins(a), { timeout: 10_000 }).toBe(serverCoins);
    else expect(shown, "현재 동작: 방에 머무는 동안 상단 재화는 경기 시작 전 값").toBe(start.coins);
  }

  // 4) 홈으로(새로고침 없이 앱 안에서): 상단 재화는 갱신되고, 보상 알림은 마지막 경기 것만 (H-A3-3, 현재 동작)
  await a.getByRole("button", { name: "나가기" }).click();
  await a.evaluate(() => (location.hash = "#home"));
  const finalServer = (await api(A.session, "/api/me/economy")).snapshot.wallet.coins as number;
  await expect.poll(() => shownCoins(a), { timeout: 10_000 }).toBe(finalServer);
  const toasts = a.locator(".match-rewards");
  observations.push(`home: top bar ${await shownCoins(a)} (server ${finalServer}); reward notices ${await toasts.count()}`);
  expect(await toasts.count(), "현재 동작: 홈 보상 알림은 한 경기분만").toBeLessThanOrEqual(1);
  // 5) 프로필(앱 안 이동, 새로 마운트): 서버 기록 두 경기가 보인다
  await a.evaluate(() => (location.hash = "#profile"));
  await expect(a.getByRole("region", { name: "대전 전적" }).locator(".profile-kpis div").first()).toContainText("2");
  testInfo.annotations.push({ type: "A3 재현", description: observations.join(" | ") });
  console.log("[A3 rematch]", observations.join("\n"));
});

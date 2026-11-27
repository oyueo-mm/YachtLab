import { returningVisitorState } from "./visitor";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { startLocalWorker, type LocalWorker } from "../helpers/wrangler";
import { fakeLogin, startFakeIdp, type FakeIdp } from "../helpers/fake-idp";
import { apiCall } from "../helpers/member-look";

/**
 * A4 friend requests from a real match (isolated local Worker + fake sign-in, two members): the
 * opponent's profile shows the right state, one tap sends ONE request, pending/friend/blocked are
 * respected and shown, and the other account sees the request in its inbox. The Worker friend API is
 * used as is (nothing was changed there).
 */
const ORIGIN = "http://127.0.0.1:5173";
let worker: LocalWorker;
let idp: FakeIdp;
const sessions: string[] = [];
const contexts: BrowserContext[] = [];
test.beforeAll(async ({}, info) => {
  if (info.project.name === "mobile") return;
  test.setTimeout(120_000);
  idp = await startFakeIdp();
  worker = await startLocalWorker({ ALLOWED_ORIGINS: ORIGIN, TURN_TIMEOUT_MS: "0", CREATE_PER_MINUTE: "500", JOIN_PER_MINUTE: "500", GOOGLE_CLIENT_ID: "test-client", GOOGLE_CLIENT_SECRET: "test-secret", AUTH_SECRET: "s".repeat(40), APP_URL: ORIGIN + "/YachtLab/", TEST_OIDC_ISSUER: idp.issuer, ECONOMY: "on" });
});
test.afterEach(async () => { await Promise.all(contexts.splice(0).map((c) => c.close().catch(() => undefined))); });
test.afterAll(async () => { await worker?.stop(); idp?.close(); });
const entry = () => `?online-server=${encodeURIComponent(worker.url)}#online`;
async function device(browser: Browser, session: string, size = { width: 1280, height: 800 }): Promise<Page> {
  const ctx = await browser.newContext({ storageState: returningVisitorState(), viewport: size, baseURL: ORIGIN + "/YachtLab/", reducedMotion: "reduce" });
  await ctx.addInitScript((s) => { localStorage.setItem("yachtlab.session.v1", s); localStorage.setItem("yachtlab.settings.v1", JSON.stringify({ muted: true, diceQuality: "2.5d" })); }, session);
  contexts.push(ctx);
  return ctx.newPage();
}
async function openOpponentProfile(p: Page) {
  await p.locator('.seat-chip[data-role="opponent"]').first().click();
  await p.getByRole("button", { name: /프로필 보기/ }).click();
  return p.getByRole("dialog", { name: "상대 프로필" });
}

test("경기 중 상대 프로필에서 친구 요청: 한 번만 보내지고, 대기·친구·차단 상태를 존중해 표시한다", async ({ browser }, info) => {
  test.skip(info.project.name === "mobile", "두 기기를 한 테스트에서 직접 만든다");
  test.setTimeout(180_000);
  sessions[0] = await fakeLogin(worker.url, idp, "a4-one", ORIGIN);
  sessions[1] = await fakeLogin(worker.url, idp, "a4-two", ORIGIN);
  const [a, b] = [await device(browser, sessions[0]), await device(browser, sessions[1])];
  for (const p of [a, b]) { await p.goto(entry()); await p.getByRole("button", { name: "빠른 대전 시작" }).click(); }
  for (const p of [a, b]) await expect(p.locator(".roll-button")).toBeVisible({ timeout: 20_000 });

  // A: opponent profile → one request
  const dialogA = await openOpponentProfile(a);
  const add = dialogA.getByRole("button", { name: /친구 추가/ });
  await expect(add).toBeVisible();
  await add.dblclick(); // a double tap must still send exactly one request
  await expect(dialogA.getByText("친구 요청을 보냈어요")).toBeVisible();
  if (process.env.A4_SHOTS) await dialogA.screenshot({ path: `docs/ui/a4-mobile/${process.env.A4_SHOTS}-friend-pending.png` });
  await expect(dialogA.getByRole("button", { name: /친구 추가/ })).toHaveCount(0);
  const inbox = await apiCall(worker, sessions[1], "/api/me/friends");
  expect(inbox.body.incoming).toHaveLength(1);
  const outgoing = await apiCall(worker, sessions[0], "/api/me/friends");
  expect(outgoing.body.outgoing).toHaveLength(1);

  // B sees that A already asked (no second request possible from here either)
  const dialogB = await openOpponentProfile(b);
  await expect(dialogB.getByText("상대가 먼저 요청했어요")).toBeVisible();
  await expect(dialogB.getByRole("button", { name: /친구 추가/ })).toHaveCount(0);

  // B accepts through the API (the friends page flow is covered by the existing friends tests); A reopens the profile
  const code = inbox.body.incoming[0].code as string;
  expect((await apiCall(worker, sessions[1], "/api/me/friends/accept", { code })).status).toBe(200);
  await a.getByRole("button", { name: "닫기" }).click();
  await a.waitForTimeout(8500); // the shared relation cache is short-lived
  const again = await openOpponentProfile(a);
  await expect(again.getByText("이미 친구예요")).toBeVisible();
  if (process.env.A4_SHOTS) await again.screenshot({ path: `docs/ui/a4-mobile/${process.env.A4_SHOTS}-friend-already.png` });
  await expect(again.getByRole("button", { name: /친구 추가/ })).toHaveCount(0);

  // blocked: A removes B, then blocks B → the profile says so and offers no button
  await apiCall(worker, sessions[0], "/api/me/friends/remove", { code: inbox.body.me ? (await apiCall(worker, sessions[0], "/api/me/friends")).body.friends[0].code : code });
  const peer = (await apiCall(worker, sessions[0], "/api/me/friends")).body;
  void peer;
  const bCode = (await apiCall(worker, sessions[1], "/api/me/friends")).body.me.code as string;
  expect((await apiCall(worker, sessions[0], "/api/me/friends/block", { code: bCode })).status).toBe(200);
  await a.getByRole("button", { name: "닫기" }).click();
  await a.waitForTimeout(8500);
  const blocked = await openOpponentProfile(a);
  await expect(blocked.getByText("차단한 사용자예요")).toBeVisible();
  if (process.env.A4_SHOTS) await blocked.screenshot({ path: `docs/ui/a4-mobile/${process.env.A4_SHOTS}-friend-blocked.png` });
  await expect(blocked.getByRole("button", { name: /친구 추가/ })).toHaveCount(0);
});

test("친구 화면의 최근 대전 상대에서도 같은 버튼으로 친구를 추가한다(손님·AI 제외)", async ({ browser }, info) => {
  test.skip(info.project.name === "mobile", "두 기기를 한 테스트에서 직접 만든다");
  test.setTimeout(240_000);
  const s1 = await fakeLogin(worker.url, idp, "a4-three", ORIGIN);
  const s2 = await fakeLogin(worker.url, idp, "a4-four", ORIGIN);
  // play one full quick match through the real protocol so both accounts have a server-verified record
  const { playMatchBetween } = await import("../helpers/member-look");
  await playMatchBetween(worker, s1, s2);
  const a = await device(browser, s1);
  await a.goto(`?online-server=${encodeURIComponent(worker.url)}#friends`);
  const list = a.getByRole("list", { name: "최근 대전 상대" });
  await expect(list.locator("li")).toHaveCount(1, { timeout: 15_000 });
  // The opponent never opened the app yet, so they have no friend code: nothing is sent, the row says how to add them.
  await expect(list.getByText(/친구 코드로 추가할 수 있어요/)).toBeVisible({ timeout: 15_000 });
  await expect(list.getByRole("button", { name: /친구 추가/ })).toHaveCount(0);
  // Once that account has used the friends feature (the app does this on its own at sign-in), the button appears.
  await apiCall(worker, s2, "/api/me/friends");
  await a.reload();
  await expect(list.locator("li")).toHaveCount(1, { timeout: 15_000 });
  await list.getByRole("button", { name: /친구 추가/ }).click();
  await expect(list.getByText("친구 요청을 보냈어요")).toBeVisible();
  if (process.env.A4_SHOTS) await a.screenshot({ path: `docs/ui/a4-mobile/${process.env.A4_SHOTS}-friends-recent-opponents.png` });
  await expect(a.getByRole("list", { name: "보낸 친구 요청" }).locator("li")).toHaveCount(1, { timeout: 15_000 });
});

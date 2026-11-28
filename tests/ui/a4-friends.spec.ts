import { returningVisitorState } from "./visitor";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { startLocalWorker, type LocalWorker } from "../helpers/wrangler";
import { fakeLogin, startFakeIdp, type FakeIdp } from "../helpers/fake-idp";
import { apiCall, playMatchBetween } from "../helpers/member-look";

/**
 * A4 friend requests from a real match (isolated local Worker + fake sign-in, two members). SOC-1: the
 * Worker now binds an account id to its friend code ITSELF (only for a member seated with me / a server-
 * verified opponent), so the "친구 추가" button appears — nothing is guessed from nicknames or public
 * numbers, nothing is sent automatically, and one tap sends exactly one request to that account.
 * Also: switching accounts in the same tab shows only the new account's data, even when the previous
 * account's answer arrives late.
 */
const ORIGIN = "http://127.0.0.1:5173";
let worker: LocalWorker;
let idp: FakeIdp;
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
  await ctx.addInitScript((s) => { if (!localStorage.getItem("yachtlab.session.v1")) localStorage.setItem("yachtlab.session.v1", s); localStorage.setItem("yachtlab.settings.v1", JSON.stringify({ muted: true, diceQuality: "2.5d" })); }, session);
  contexts.push(ctx);
  return ctx.newPage();
}
async function openOpponentProfile(p: Page) {
  await p.locator('.seat-chip[data-role="opponent"]').first().click();
  await p.getByRole("button", { name: /프로필 보기/ }).click();
  return p.getByRole("dialog", { name: "상대 프로필" });
}
const friendState = async (session: string) => (await apiCall(worker, session, "/api/me/friends")).body;

test("경기 중 상대 프로필: 서버가 계정-코드 대응을 확인한 뒤에만 친구 추가, 자동 전송 없음, 한 번 누르면 그 계정에만 한 건", async ({ browser }, info) => {
  test.skip(info.project.name === "mobile", "두 기기를 한 테스트에서 직접 만든다");
  test.setTimeout(180_000);
  const s1 = await fakeLogin(worker.url, idp, "a4-one", ORIGIN);
  const s2 = await fakeLogin(worker.url, idp, "a4-two", ORIGIN);
  // Both accounts have used the friends feature (so they ARE in the search index): even then nothing is guessed.
  await friendState(s1);
  await friendState(s2);
  const [a, b] = [await device(browser, s1), await device(browser, s2)];
  for (const p of [a, b]) { await p.goto(entry()); await p.getByRole("button", { name: "빠른 대전 시작" }).click(); }
  for (const p of [a, b]) await expect(p.locator(".roll-button")).toBeVisible({ timeout: 20_000 });
  const dialogA = await openOpponentProfile(a);
  const add = dialogA.getByRole("button", { name: /친구 추가/ });
  await expect(add).toBeVisible();
  await expect(dialogA.getByText(/이미 친구|요청을 보냈어요|차단/)).toHaveCount(0); // no state is invented
  // opening the profile sent nothing
  for (const s of [s1, s2]) expect((await friendState(s)).outgoing).toHaveLength(0);
  await add.dblclick();
  await expect(dialogA.getByText(/친구 요청을 보냈어요/)).toBeVisible();
  const aCode = (await friendState(s1)).me.code;
  const incoming = (await friendState(s2)).incoming;
  expect(incoming).toHaveLength(1); // a double tap is one request
  expect(incoming[0].code).toBe(aCode);
  expect((await friendState(s1)).outgoing).toHaveLength(1);
  // B sees A asked first (from the server, not guessed)
  const dialogB = await openOpponentProfile(b);
  await expect(dialogB.getByText(/상대가 먼저 요청했어요/)).toBeVisible();
});

test("최근 대전 상대: 서버가 확인한 상대에게만 친구 추가 버튼(자동 전송 없음), 계정을 바꾸면 이전 계정의 목록·늦은 응답이 섞이지 않는다", async ({ browser }, info) => {
  test.skip(info.project.name === "mobile", "두 기기를 한 테스트에서 직접 만든다");
  test.setTimeout(240_000);
  const s1 = await fakeLogin(worker.url, idp, "a4-three", ORIGIN);
  const s2 = await fakeLogin(worker.url, idp, "a4-four", ORIGIN);
  await playMatchBetween(worker, s1, s2); // A plays as "가" (its opponent is "나"); B's opponent is "가"
  const a = await device(browser, s1);
  // A's records answer slowly: a late answer must not appear after the account was switched
  await a.route(/\/api\/me\/records/, async (route) => {
    const auth = route.request().headers()["authorization"] ?? "";
    if (auth.includes(s1)) await new Promise((r) => setTimeout(r, 2500));
    await route.continue();
  });
  await a.goto(`?online-server=${encodeURIComponent(worker.url)}#friends`);
  // switch to B right away, in the same tab (what a sign-out / sign-in does)
  await a.evaluate((s) => { localStorage.setItem("yachtlab.session.v1", s); window.dispatchEvent(new Event("yachtlab-session")); }, s2);
  const list = a.getByRole("list", { name: "최근 대전 상대" });
  await expect(list.locator("li")).toHaveCount(1, { timeout: 15_000 });
  await a.waitForTimeout(3500); // A's slow answer has arrived by now
  await expect(list).toContainText("가"); // B's opponent
  await expect(list).not.toContainText("나"); // A's opponent never shows under B
  await expect(list.getByRole("button", { name: /친구 추가/ })).toHaveCount(1);
  if (process.env.A4_SHOTS) await a.screenshot({ path: `docs/ui/a4-mobile/${process.env.A4_SHOTS}-friends-recent-opponents.png` });
  for (const s of [s1, s2]) expect((await friendState(s)).outgoing).toHaveLength(0); // nothing was sent
});

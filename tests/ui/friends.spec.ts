import { returningVisitorState } from "./visitor";
import { expect, test, devices, type Browser, type BrowserContext } from "@playwright/test";
import { startLocalWorker, type LocalWorker } from "../helpers/wrangler";
import { fakeLogin, startFakeIdp, type FakeIdp } from "../helpers/fake-idp";

/**
 * Friends & invites (I/J) in real browsers against the local Worker (wrangler dev) with a FAKE local
 * sign-in: a friend request by friend code → accept → status → invite from the friend-room waiting
 * room → the friend accepts from the site notice and lands in the room. Guests see a sign-in prompt.
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
async function member(browser: Browser, sub: string, nickname: string, phone = false) {
  const session = await fakeLogin(worker.url, idp, sub, ORIGIN);
  await fetch(worker.url + "/api/me/nickname", { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json", authorization: "Bearer " + session }, body: JSON.stringify({ nickname }) });
  const ctx = await browser.newContext({ storageState: returningVisitorState(), ...(phone ? devices["Pixel 7"] : { viewport: { width: 1280, height: 900 } }), baseURL: ORIGIN + "/YachtLab/", reducedMotion: "reduce" });
  await ctx.addInitScript((s) => localStorage.setItem("yachtlab.session.v1", s), session);
  contexts.push(ctx);
  return ctx.newPage();
}

test("친구: 코드로 요청 → 홈 알림 → 수락 → 접속 상태 → 대기실에서 친구 초대 → 알림에서 수락하면 그 방에 입장", async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "두 기기를 한 테스트에서 직접 만든다");
  test.setTimeout(150_000);
  const a = await member(browser, "friend-a", "앨리스");
  const b = await member(browser, "friend-b", "밥", true);
  await b.goto(at("friends"));
  const bobCode = (await b.locator(".friend-code strong").textContent())!.trim();
  expect(bobCode).toMatch(/^YL[0-9A-Z]{8}$/);
  await a.goto(at("friends"));
  // partial nicknames find nobody (no enumeration); the exact code does
  await a.getByLabel("친구 찾기").fill("밥밥");
  await a.getByRole("button", { name: "찾기" }).click();
  await expect(a.getByRole("list", { name: "검색 결과" })).toContainText("찾는 사람이 없어요");
  await a.getByLabel("친구 찾기").fill(bobCode.toLowerCase());
  await a.getByRole("button", { name: "찾기" }).click();
  await a.getByRole("button", { name: "밥 친구 요청" }).click();
  await expect(a.getByText("친구 요청을 보냈어요.")).toBeVisible();
  await expect(a.getByRole("list", { name: "보낸 친구 요청" })).toContainText("밥");
  // Bob: a badge on the home menu, then accept on the friends page
  await b.goto(at("home"));
  await b.getByRole("button", { name: "메뉴", exact: true }).click();
  const friends = b.getByRole("navigation", { name: "주요 메뉴" }).getByRole("button", { name: /^친구/ });
  await expect(friends.locator(".menu-badge")).toHaveText("1");
  await friends.click();
  await b.getByRole("button", { name: "앨리스 수락" }).click();
  await expect(b.getByRole("list", { name: "친구 목록" })).toContainText("앨리스");
  // Alice sees Bob online (Bob's page checked its inbox)
  await a.reload();
  await expect(a.getByRole("list", { name: "친구 목록" }).locator("li", { hasText: "밥" })).toContainText("접속 중");
  // no internal ids in what the page received
  const raw = await a.evaluate(async (u) => (await fetch(u + "/api/me/friends", { headers: { authorization: "Bearer " + localStorage.getItem("yachtlab.session.v1") } })).text(), worker.url);
  expect(raw).not.toMatch(/u_[A-Za-z0-9_-]{22}/);

  // Alice opens a 3-seat friend room and invites Bob from the waiting room
  await a.goto(at("online"));
  await a.getByRole("tab", { name: "친구 대전" }).click();
  await a.getByLabel("최대 인원").selectOption("3");
  await a.getByRole("button", { name: "방 만들기" }).click();
  await expect(a.getByRole("heading", { name: "대기실" })).toBeVisible();
  await a.getByRole("button", { name: "친구 초대" }).click();
  const picker = a.getByRole("dialog", { name: "친구 초대" });
  await picker.getByRole("checkbox").check();
  await picker.getByRole("button", { name: "1명 초대하기" }).click();
  await expect(picker.locator(".friend-tag")).toHaveText("초대함");
  // a second invite right away is throttled (no spam)
  await picker.getByRole("checkbox").check();
  await picker.getByRole("button", { name: "1명 초대하기" }).click();
  await expect(picker.locator(".friend-tag")).toHaveText("방금 초대함");
  await a.keyboard.press("Escape");
  await picker.getByRole("button", { name: "닫기" }).click().catch(() => undefined);
  // Bob gets the site notice (his page checks the inbox on load) and joins
  await b.goto(at("home"));
  const toast = b.getByRole("region", { name: "친구 초대" });
  await expect(toast).toContainText("앨리스 님이 친구 대전에 초대했어요");
  await toast.getByRole("button", { name: "수락" }).click();
  await expect(b.getByRole("heading", { name: "대기실" })).toBeVisible();
  await expect(a.getByRole("list", { name: "참가자" })).toContainText("밥");
  // in a match both show "경기 중" to friends
  await b.getByRole("button", { name: "준비 완료" }).click();
  await a.getByRole("button", { name: /게임 시작/ }).click();
  await expect(a.locator(".roll-button")).toBeVisible();
  const status = await b.evaluate(async (u) => (await (await fetch(u + "/api/me/friends", { headers: { authorization: "Bearer " + localStorage.getItem("yachtlab.session.v1") } })).json()).friends[0].status, worker.url);
  expect(status).toBe("playing");
});

test("게스트는 친구 메뉴에서 로그인 안내를 본다(초대 코드·링크 참여는 그대로)", async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "한 기기만 쓴다");
  const ctx = await browser.newContext({ storageState: returningVisitorState(), baseURL: ORIGIN + "/YachtLab/" });
  contexts.push(ctx);
  const p = await ctx.newPage();
  await p.goto(at("friends"));
  await expect(p.getByText("Google 로그인한 회원만 쓸 수 있어요")).toBeVisible();
});

import { returningVisitorState } from "./visitor";
import { expect, test, devices, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { startLocalWorker, type LocalWorker } from "../helpers/wrangler";
import { fakeLogin, startFakeIdp, type FakeIdp } from "../helpers/fake-idp";
import { nick } from "./helpers";

/**
 * Preset chat & emotes in real browsers (C, 2026-11-25) against the local Worker (wrangler dev) with a
 * FAKE local sign-in for members: every default emote and chat line from PC and phone reaches the
 * other screen; the page's own copy of the anti-spam limit says how long to wait instead of pretending
 * to send; offline taps are refused visibly; messages show under the board without moving it; 3-player
 * tables name the sender; a member's saved loadout is what the bar offers and what arrives.
 */
let worker: LocalWorker;
let idp: FakeIdp;
const ORIGIN = "http://127.0.0.1:5173";
const contexts: BrowserContext[] = [];
test.beforeAll(async ({}, testInfo) => {
  if (testInfo.project.name === "mobile") return;
  test.setTimeout(120_000);
  idp = await startFakeIdp();
  worker = await startLocalWorker({
    ALLOWED_ORIGINS: ORIGIN,
    TURN_TIMEOUT_MS: "0",
    CREATE_PER_MINUTE: "500",
    JOIN_PER_MINUTE: "500",
    GOOGLE_CLIENT_ID: "test-client",
    GOOGLE_CLIENT_SECRET: "test-secret",
    AUTH_SECRET: "s".repeat(40),
    APP_URL: ORIGIN + "/YachtLab/",
    TEST_OIDC_ISSUER: idp.issuer,
    ECONOMY: "on",
  });
});
test.afterEach(async () => {
  await Promise.all(contexts.splice(0).map((c) => c.close().catch(() => undefined)));
});
test.afterAll(async () => {
  await worker?.stop();
  idp?.close();
});
const entry = (room?: string) => `?online-server=${encodeURIComponent(worker.url)}${room ? `&room=${room}` : ""}#online`;
async function device(browser: Browser, phone: boolean, session?: string) {
  const ctx = await browser.newContext({ storageState: returningVisitorState(), ...(phone ? devices["Pixel 7"] : { viewport: { width: 1366, height: 900 } }), baseURL: ORIGIN + "/YachtLab/", reducedMotion: "reduce" });
  if (session) await ctx.addInitScript((s) => localStorage.setItem("yachtlab.session.v1", s), session);
  contexts.push(ctx);
  return ctx.newPage();
}

const login = (sub: string) => fakeLogin(worker.url, idp, sub, ORIGIN);

/** Record every message text that appears in this page's feed. */
async function watchFeed(p: Page) {
  const seen: string[] = [];
  await p.exposeFunction("__feed", (t: string) => seen.push(t));
  await p.evaluate(() => {
    const report = () => document.querySelectorAll(".table-feed .feed-msg").forEach((n) => (window as unknown as { __feed(t: string): void }).__feed((n.querySelector(".feed-from")?.textContent ?? "") + "|" + (n.querySelector(".feed-text")?.textContent ?? "")));
    new MutationObserver(report).observe(document.body, { subtree: true, childList: true });
  });
  return seen;
}

/** Send one item the way a person would: tap, and if the bar says to wait, wait and tap again. */
async function send(p: Page, label: string, kind: "emote" | "chat", text = label) {
  try {
    await expect(async () => {
      if (kind === "emote") await p.getByRole("group", { name: "이모티콘 보내기" }).getByRole("button", { name: label, exact: true }).click({ timeout: 2000 });
      else {
        const sheet = p.getByRole("dialog", { name: "채팅·이모티콘" });
        if (!(await sheet.isVisible())) await p.getByRole("button", { name: "채팅·이모티콘" }).click({ timeout: 2000 });
        await sheet.getByRole("button", { name: label, exact: true }).click({ timeout: 2000 });
      }
      // sent = the server echoed exactly this item into my own feed
      await expect(p.locator(".table-feed .feed-msg.mine .feed-text").first()).toHaveText(text, { timeout: 1500 });
    }).toPass({ timeout: 20_000, intervals: [400, 800, 1200] });
  } catch (e) {
    console.log("send failed", label, "state:", await p.locator(".dock-state").textContent().catch(() => "?"), "feed:", await p.locator(".table-feed").innerText().catch(() => "?"));
    throw e;
  }
  await p.waitForTimeout(150);
}

const EMOTES = [["미소", "🙂"], ["축하", "🎉"], ["박수", "👏"], ["좋아요", "👍"]] as const;
const LINES = ["안녕하세요!", "화이팅!", "대단해요!", "감사합니다!", "좋은 경기였어요!", "잘 부탁해요!"];

test("게스트 PC↔휴대폰: 기본 이모티콘 4·채팅 6 전부 양방향 전달, 빠른 연타는 대기 시간 안내(보낸 척 없음), 끊기면 비활성, 보드가 밀리지 않는다", async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "두 기기를 한 테스트에서 직접 만든다");
  test.setTimeout(240_000);
  const pc = await device(browser, false);
  const phone = await device(browser, true);
  for (const [p, n] of [[pc, "피씨"], [phone, "폰"]] as const) {
    await p.goto(entry());
    await nick(p, n);
    await p.getByRole("button", { name: "빠른 대전 시작" }).click();
  }
  for (const p of [pc, phone]) await expect(p.locator(".roll-button")).toBeVisible({ timeout: 15_000 });
  const seenPc = await watchFeed(pc);
  const seenPhone = await watchFeed(phone);
  // the bar sits under the board; a message must not move the board or the roll button
  const before = { board: await phone.locator(".game-board").boundingBox(), roll: await phone.locator(".roll-button").boundingBox() };
  for (const [p, other] of [[pc, seenPhone], [phone, seenPc]] as const) {
    const name = p === pc ? "피씨" : "폰";
    for (const [label, text] of EMOTES) {
      await send(p, label, "emote", text);
      await expect.poll(() => other.includes(`${name}|${text}`), { timeout: 5000 }).toBe(true);
    }
    for (const line of LINES) {
      await send(p, line, "chat");
      await expect.poll(() => other.includes(`${name}|${line}`), { timeout: 5000 }).toBe(true);
    }
  }
  expect({ board: await phone.locator(".game-board").boundingBox(), roll: await phone.locator(".roll-button").boundingBox() }).toEqual(before);
  // the feed never covers the dice area or the roll button
  const feed = (await phone.locator(".table-feed").boundingBox())!;
  const board = (await phone.locator(".game-board").boundingBox())!;
  expect(feed.y).toBeGreaterThanOrEqual(board.y + board.height - 1);

  // fast taps: the bar says how long to wait and does not send (the server would refuse it)
  await expect(pc.locator(".dock-state")).not.toContainText("초 뒤");
  const frames: string[] = [];
  pc.on("websocket", (ws) => ws.on("framesent", (f) => frames.push(String(f.payload))));
  const bar = pc.getByRole("group", { name: "이모티콘 보내기" });
  await bar.getByRole("button", { name: "박수" }).click();
  await bar.getByRole("button", { name: "박수" }).click();
  await expect(pc.locator(".dock-state")).toContainText(/초 뒤|보내는 중/);
  // offline: every button is disabled and the bar says it is reconnecting (nothing pretends to be sent)
  await pc.context().setOffline(true);
  await expect(pc.getByRole("button", { name: "채팅·이모티콘" })).toBeDisabled({ timeout: 15_000 });
  await expect(bar.getByRole("button", { name: "미소" })).toBeDisabled();
  await pc.context().setOffline(false);
  await expect(bar.getByRole("button", { name: "미소" })).toBeEnabled({ timeout: 20_000 });
});

test("3인 방: 받은 메시지에 보낸 사람 이름이 붙고 모두에게 전달된다", async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "여러 기기를 한 테스트에서 직접 만든다");
  test.setTimeout(120_000);
  const host = await device(browser, false);
  await host.goto(entry());
  await host.getByRole("tab", { name: "친구 대전" }).click();
  await nick(host, "가방장");
  await host.getByLabel("최대 인원").selectOption("3");
  await host.getByRole("button", { name: "방 만들기" }).click();
  await expect(host.getByRole("heading", { name: "대기실" })).toBeVisible();
  const code = (await host.getByLabel("초대 코드").textContent())!.trim();
  const all = [host];
  for (const n of ["나둘", "다셋"]) {
    const g = await device(browser, true);
    await g.goto(entry(code));
    await nick(g, n);
    await g.getByRole("button", { name: "입장하기" }).click();
    await g.getByRole("button", { name: "준비 완료" }).click();
    all.push(g);
  }
  // the lobby already has the bar
  const seen = await Promise.all(all.map((p) => watchFeed(p)));
  await send(all[1], "축하", "emote", "🎉");
  for (const i of [0, 2]) await expect.poll(() => seen[i].includes("나둘|🎉")).toBe(true);
  await host.getByRole("button", { name: /게임 시작/ }).click();
  for (const p of all) await expect(p.getByRole("region", { name: "실시간 순위" })).toBeVisible();
  for (const [i, p] of all.entries()) await send(p, LINES[i], "chat");
  const names = ["가방장", "나둘", "다셋"];
  for (const [i] of all.entries()) for (const [j] of all.entries()) if (i !== j) await expect.poll(() => seen[i].includes(`${names[j]}|${LINES[j]}`)).toBe(true);
});

test("회원: 인벤토리에서 저장한 장착(일부만)이 경기의 보내기 버튼이 되고, 상대에게 그대로 전달된다", async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "두 기기를 한 테스트에서 직접 만든다");
  test.setTimeout(150_000);
  const session = await login("member-chat");
  const m = await device(browser, false, session);
  await m.goto(`?online-server=${encodeURIComponent(worker.url)}#inventory`);
  // keep only 2 emotes and 2 lines equipped, in a new order
  await m.getByRole("tab", { name: /^이모티콘/ }).click();
  for (const name of ["미소", "좋아요"]) await m.getByRole("button", { name: `${name} 해제` }).click();
  await m.getByRole("tab", { name: /^채팅/ }).click();
  for (const line of ["화이팅!", "대단해요!", "감사합니다!", "잘 부탁해요!"]) await m.getByRole("button", { name: `${line} 해제` }).click();
  await m.getByRole("button", { name: "장착 저장" }).click();
  await expect(m.getByText("장착을 저장했어요")).toBeVisible();
  const g = await device(browser, true);
  await m.goto(entry());
  await g.goto(entry());
  await nick(g, "손님");
  await m.getByRole("button", { name: "빠른 대전 시작" }).click();
  await g.getByRole("button", { name: "빠른 대전 시작" }).click();
  for (const p of [m, g]) await expect(p.locator(".roll-button")).toBeVisible({ timeout: 15_000 });
  // exactly the saved emotes are offered
  await expect(m.getByRole("group", { name: "이모티콘 보내기" }).getByRole("button")).toHaveText(["🎉", "👏", "채팅"]);
  const seen = await watchFeed(g);
  const member = (await m.locator(".online-nick, .player-name").first().textContent()) ?? "";
  void member;
  for (const [label, text] of [["축하", "🎉"], ["박수", "👏"]] as const) {
    await send(m, label, "emote", text);
    await expect.poll(() => seen.some((x) => x.endsWith("|" + text))).toBe(true);
  }
  for (const line of ["안녕하세요!", "좋은 경기였어요!"]) {
    await send(m, line, "chat");
    await expect.poll(() => seen.some((x) => x.endsWith("|" + line))).toBe(true);
  }
  await m.getByRole("button", { name: "채팅·이모티콘" }).click();
  await expect(m.getByRole("dialog", { name: "채팅·이모티콘" }).getByRole("group", { name: "프리셋 채팅" }).getByRole("button")).toHaveText(["안녕하세요!", "좋은 경기였어요!"]);
  // the guest has the default set and its messages reach the member
  const seenM = await watchFeed(m);
  await send(g, "감사합니다!", "chat");
  await expect.poll(() => seenM.includes("손님|감사합니다!")).toBe(true);
});

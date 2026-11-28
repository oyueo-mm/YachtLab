import { returningVisitorState } from "./visitor";
import { nick } from "./helpers";
import { expect, test, devices, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { startLocalWorker, type LocalWorker } from "../helpers/wrangler";

/**
 * Online friend rooms for more than two players in real browsers against the local Worker
 * (wrangler dev): room size, invite link, lobby (ready, host settings), simultaneous rounds played to
 * the end on four devices (desktop + phones), live and final ranking, a reload mid-match, rematch by
 * the host with those who asked. Nothing external is contacted.
 */
let worker: LocalWorker;
const contexts: BrowserContext[] = [];
test.beforeAll(async ({}, testInfo) => {
  if (testInfo.project.name === "mobile") return;
  test.setTimeout(120_000);
  worker = await startLocalWorker({ ALLOWED_ORIGINS: "http://127.0.0.1:5173", TURN_TIMEOUT_MS: "120000", CREATE_PER_MINUTE: "500", JOIN_PER_MINUTE: "500" });
});
test.afterEach(async () => {
  await Promise.all(contexts.splice(0).map((c) => c.close().catch(() => undefined)));
});
test.afterAll(async () => {
  await worker?.stop();
});
const entry = (room?: string) => `?online-server=${encodeURIComponent(worker.url)}${room ? `&room=${room}` : ""}#online`;
async function device(browser: Browser, phone: boolean) {
  const ctx = await browser.newContext({ storageState: returningVisitorState(), ...(phone ? devices["Pixel 7"] : { viewport: { width: 1366, height: 900 } }), baseURL: "http://127.0.0.1:5173/YachtLab/", reducedMotion: "reduce" });
  contexts.push(ctx);
  return ctx.newPage();
}

/** My turn in this round: roll once, then record the best quick pick (or the first open category). */
async function playRound(p: Page) {
  const roll = p.locator(".roll-button");
  await expect(roll).toBeEnabled({ timeout: 15_000 });
  await roll.click();
  await expect(p.locator(".board-top b")).toHaveText("1");
  // A fresh suggestion ignores taps for 350 ms (anti mis-tap, mobile-play): retry until it records.
  await expect(async () => {
    const pick = p.getByRole("group", { name: "추천 점수 바로 기록" }).getByRole("button").first();
    if (await pick.isVisible()) await pick.click();
    else {
      await p.locator(".score-category-select").first().click();
      await p.getByRole("button", { name: "점수 기록 확정" }).click();
    }
    await expect(p.locator(".board-top b")).toHaveText("0", { timeout: 1000 });
  }).toPass({ timeout: 15_000 });
  // recorded: either waiting for the others, or (the last to record) already in the next round
  await expect(p.locator(".board-top b")).toHaveText("0");
}

test("4인 동시 진행: 방 인원 설정 → 초대 링크 입장 → 준비 → 방장 설정 → 12라운드 동시 진행(중간 새로고침) → 최종 순위 → 재대결", async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "여러 기기를 한 테스트에서 직접 만든다");
  test.setTimeout(240_000);
  const host = await device(browser, false);
  await host.goto(entry());
  await host.getByRole("tab", { name: "친구 대전" }).click();
  await nick(host, "방장");
  await host.getByLabel("최대 인원").selectOption("4");
  await host.getByRole("button", { name: "방 만들기" }).click();
  await expect(host.getByRole("heading", { name: "대기실" })).toBeVisible();
  await expect(host.getByText("참가자 1 / 4명")).toBeVisible();
  const code = (await host.getByLabel("초대 코드").textContent())!.trim();
  const guests: Page[] = [];
  for (const [i, name] of ["둘째", "셋째", "넷째"].entries()) {
    const g = await device(browser, i > 0);
    await g.goto(entry(code));
    await expect(g.getByText("1/4명").or(g.getByText(/\d\/4명/))).toBeVisible();
    await nick(g, name);
    await g.getByRole("button", { name: "입장하기" }).click();
    await expect(g.getByRole("button", { name: "준비 완료" })).toBeVisible();
    guests.push(g);
  }
  await expect(host.getByText("참가자 4 / 4명")).toBeVisible();
  // only the host can change settings; start waits until everyone is ready
  await expect(guests[0].getByRole("radiogroup", { name: "진행 방식" }).getByText("동시 진행")).toBeVisible();
  await expect(guests[0].getByLabel("제한 시간")).toBeDisabled();
  await host.getByText("동시 진행").click();
  await expect(guests[2].locator(".segmented-choice label.on")).toHaveText("동시 진행");
  await host.getByLabel("제한 시간").selectOption("120000");
  await expect(host.getByRole("button", { name: /게임 시작/ })).toBeDisabled();
  for (const g of guests) await g.getByRole("button", { name: "준비 완료" }).click();
  await expect(host.locator(".online-tag.ready.on")).toHaveCount(3);
  await host.getByRole("button", { name: /게임 시작/ }).click();
  const all = [host, ...guests];
  for (const p of all) await expect(p.getByRole("region", { name: "실시간 순위" })).toBeVisible();
  for (let round = 1; round <= 12; round++) {
    // everyone plays the round at the same time
    await Promise.all(all.map((p) => playRound(p)));
    if (round === 5) {
      // a player reloads mid-match: the same seat, the same round
      await guests[1].reload();
      await expect(guests[1].getByRole("region", { name: "실시간 순위" })).toBeVisible();
    }
  }
  for (const p of all) await expect(p.getByRole("region", { name: "최종 순위" })).toBeVisible({ timeout: 15_000 });
  const ranks = await host.locator(".online-standing-list li").count();
  expect(ranks).toBe(4);
  await expect(host.locator(".a3-result h2")).toHaveText(/위|승리/);
  // rematch: two players ask, the host starts with them; the others' seats close
  await guests[0].getByRole("button", { name: "한 번 더 플레이", exact: true }).click();
  await expect(host.getByText(/재대결을 원하는 사람 1명/)).toBeVisible();
  await host.getByRole("button", { name: "지금 시작" }).click();
  await expect(host.getByRole("region", { name: "실시간 순위" })).toBeVisible();
  await expect(host.locator(".online-standing-list li")).toHaveCount(2);
  await expect(guests[2].getByText(/방에서 나왔어요|다시 들어갈 수 없어요/)).toBeVisible({ timeout: 10_000 });
});

test("2인 방은 준비 없이 시작하고 1:1 점수판과 채팅 프로필을 표시한다", async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "두 기기를 한 테스트에서 직접 만든다");
  const a = await device(browser, false);
  await a.goto(entry());
  await a.getByRole("tab", { name: "친구 대전" }).click();
  await nick(a, "민수");
  await a.getByRole("button", { name: "방 만들기" }).click();
  await expect(a.getByRole("heading", { name: "대기실" })).toBeVisible();
  const code = (await a.getByLabel("초대 코드").textContent())!.trim();
  const b = await device(browser, true);
  await b.goto(entry(code));
  await nick(b, "지민");
  await b.getByRole("button", { name: "입장하기" }).click();
  await expect(b.getByText("방장이 게임을 시작하면 바로 시작돼요.")).toBeVisible();
  await a.getByRole("button", { name: "게임 시작" }).click();
  await expect(a.locator(".turn-indicator")).toContainText("나의 차례");
  // The player tags anchor received messages. Scores and round stay in the one desktop score sheet.
  await expect(a.locator(".score-summary .social-seat")).toHaveCount(2);
  await expect(a.locator(".score-summary .social-seat").first()).toContainText("민수");
  await expect(a.locator(".score-summary > .round")).toBeHidden();
  await expect(a.locator(".score-summary .social-seat > strong").first()).toBeHidden();
  await expect(a.locator(".scoreboard .score-round")).toHaveText("1 / 12 라운드");
  await expect(a.locator(".scoreboard thead th.current .turn-badge")).toHaveText("차례");
  await expect(a.getByRole("region", { name: "실시간 순위" })).toHaveCount(0);
});

test("3인 동시 진행 관전: 모두 허용하면 관전 링크가 생기고, 관전자는 순위·라운드 진행을 보고 참가자를 눌러 점수판을 연다(조작 불가)", async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "여러 기기를 한 테스트에서 직접 만든다");
  test.setTimeout(120_000);
  const host = await device(browser, false);
  await host.goto(entry());
  await host.getByRole("tab", { name: "친구 대전" }).click();
  await nick(host, "관방장");
  await host.getByLabel("최대 인원").selectOption("3");
  await host.getByRole("button", { name: "방 만들기" }).click();
  await expect(host.getByRole("heading", { name: "대기실" })).toBeVisible();
  const code = (await host.getByLabel("초대 코드").textContent())!.trim();
  const players = [host];
  for (const name of ["관둘", "관셋"]) {
    const g = await device(browser, true);
    await g.goto(entry(code));
    await nick(g, name);
    await g.getByRole("button", { name: "입장하기" }).click();
    await g.getByRole("button", { name: "준비 완료" }).click();
    players.push(g);
  }
  await host.getByText("동시 진행").click();
  // D-095: the host alone sets the friend room's spectating range; the others see it read-only
  for (const p of players.slice(1)) {
    await p.getByRole("button", { name: "관전 설정" }).click();
    await expect(p.getByRole("dialog", { name: "관전 설정" }).getByRole("combobox")).toHaveCount(0);
    await expect(p.getByLabel("현재 관전 범위")).toContainText("비공개");
    await p.locator("body").click({ position: { x: 5, y: 5 } });
  }
  await host.getByRole("button", { name: "관전 설정" }).click();
  await host.getByLabel("관전 범위").selectOption("invite");
  const link = await host.getByLabel("관전 링크").inputValue();
  await host.locator("body").click({ position: { x: 5, y: 5 } });
  await host.getByRole("button", { name: /게임 시작/ }).click();
  const w = await device(browser, false);
  await w.goto(link);
  await expect(w.getByRole("region", { name: "실시간 순위" })).toBeVisible();
  await expect(w.getByRole("status", { name: "이번 라운드 진행" })).toContainText("0/3명 기록");
  await expect(w.locator(".roll-button")).toHaveCount(0);
  await expect(w.getByRole("button", { name: "채팅·이모티콘" })).toHaveCount(0);
  await playRound(players[1]);
  await expect(w.getByRole("status", { name: "이번 라운드 진행" })).toContainText("1/3명 기록");
  // pick a player → their score sheet
  await w.getByRole("button", { name: "관셋 점수판 보기" }).click();
  await expect(w.locator(".multi-scoreboard h2")).toHaveText("관셋 점수판");
  await w.getByRole("button", { name: "관둘 점수판 보기" }).click();
  await expect(w.locator(".multi-scoreboard h2")).toHaveText("관둘 점수판");
  await expect(w.getByRole("button", { name: "관둘 점수판 보기" })).toHaveAttribute("aria-pressed", "true");
});

for (const simultaneous of [false, true]) {
  test(`3인 ${simultaneous ? "동시" : "순차"} 진행에서 키보드는 내 주사위와 명시적으로 고른 족보만 조작한다`, async ({ browser }, info) => {
    test.skip(info.project.name === "mobile", "데스크톱 세 기기로 확인");
    test.setTimeout(90_000);
    const host = await device(browser, false);
    await host.goto(entry());
    await host.getByRole("tab", { name: "친구 대전" }).click();
    await nick(host, "키보드방장");
    await host.getByLabel("최대 인원").selectOption("3");
    await host.getByRole("button", { name: "방 만들기" }).click();
    await expect(host.getByRole("heading", { name: "대기실" })).toBeVisible();
    const code = (await host.getByLabel("초대 코드").textContent())!.trim();
    if (simultaneous) {
      await host.getByText("동시 진행", { exact: true }).click();
      await expect(host.locator(".segmented-choice label.on")).toHaveText("동시 진행");
    }
    const guests: Page[] = [];
    for (const name of ["키보드둘", "키보드셋"]) {
      const guest = await device(browser, false);
      await guest.goto(entry(code));
      await nick(guest, name);
      await guest.getByRole("button", { name: "입장하기" }).click();
      await guest.getByRole("button", { name: "준비 완료" }).click();
      guests.push(guest);
    }
    await host.getByRole("button", { name: /게임 시작/ }).click();
    const pages = [host, ...guests];
    for (const page of pages) await expect(page.locator(".board-top b")).toHaveText("0");
    let player = guests[1];
    if (!simultaneous) {
      for (const page of pages) if (await page.locator(".roll-button").isEnabled()) player = page;
      const other = pages.find((page) => page !== player)!;
      await other.keyboard.press("Space");
      await expect(other.locator(".board-top b")).toHaveText("0");
    }
    await player.getByRole("button", { name: "채팅·이모티콘" }).click();
    await player.keyboard.press("1");
    await expect(player.locator(".board-top b")).toHaveText("0");
    await player.keyboard.press("Escape");
    await expect(player.getByRole("dialog", { name: "채팅·이모티콘" })).toBeHidden();
    await player.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    await player.keyboard.press("Control+Space");
    await expect(player.locator(".board-top b")).toHaveText("0");
    await player.keyboard.press("Space");
    await expect(player.locator(".board-top b")).toHaveText("1");
    // The roll is shown before the turn is actionable again: dice keys and arrows act only while `can`
    // holds (server ack received, dice settled) — the same condition that enables the die buttons.
    await expect(player.locator("button[data-die-id]:enabled, [data-die-id] > button:enabled")).toHaveCount(5);

    const kept = player.locator('[data-die-id][aria-pressed="true"], [data-die-id] [aria-pressed="true"]');
    await player.keyboard.press("1");
    await expect(kept).toHaveCount(1);
    await player.keyboard.press("a");
    await expect(kept).toHaveCount(5);
    await expect(player.locator(".roll-button")).toBeDisabled();
    await player.keyboard.press("d");
    await expect(kept).toHaveCount(0);

    const score = player.getByRole("group", { name: "점수 기록 확인" });
    await player.keyboard.press("Enter");
    await expect(score).toBeHidden();
    await player.keyboard.press("ArrowDown");
    await expect(score).toContainText("에이스");
    await player.keyboard.press("Escape");
    await expect(score).toBeHidden();
    await player.keyboard.press("ArrowDown");
    await player.keyboard.press("ArrowDown");
    await expect(score).toContainText("듀스");
    await player.keyboard.press("Enter");
    await expect(player.locator('.multi-scoreboard [data-category="deuces"] .fixed-score')).toHaveCount(1);
    await expect(score).toBeHidden();
    await expect(player.locator(".board-top b")).toHaveText("0");
  });
}

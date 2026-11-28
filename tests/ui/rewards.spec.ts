import { expect, test, type Page, type Route } from "@playwright/test";
import { DEFAULT_LOADOUT, publicLook } from "../../src/economy/live/catalog";

/**
 * C5 rewards page (#rewards): attendance, activity streak, weekly best streak, inbox, redeem codes.
 * The server is a `page.route` mock with the response shapes of worker/src/index.ts; the server logic is
 * covered by tests/retention-worker.test.ts and tests/reward-grants.test.ts.
 */
const SERVER = "http://127.0.0.1:8799";
const SESSION = "s1.u_" + "a".repeat(22) + "." + "b".repeat(43);
const H = { "access-control-allow-origin": "*" };
const REWARDS = [{ coins: 10, gems: 0 }, { coins: 10, gems: 0 }, { coins: 15, gems: 0 }, { coins: 15, gems: 0 }, { coins: 20, gems: 0 }, { coins: 20, gems: 0 }, { coins: 60, gems: 3 }];
const MILESTONES = [[3, 30, 0], [7, 60, 2], [14, 100, 3], [30, 200, 5, "title.streak30"], [100, 400, 10, "title.streak100"], [180, 500, 15], [365, 1000, 30, "title.streak365"]] as const;

function server(mode: "on" | "off") {
  const state = {
    claimed: 2, claimedToday: false, coins: 900, gems: 20,
    inbox: [{ txId: "sug:s-1", source: "suggestion", coins: 300, gems: 10, items: [], label: "제안 채택 보상", status: "inboxed", createdAt: 1, expiresAt: null }],
  };
  const requests: { path: string; body: unknown }[] = [];
  const view = (granted?: unknown[]) => ({
    status: {
      enabled: true, policy: "C5-CORE@1", serverTime: Date.now(), day: 1, week: 1,
      attendance: { claimedToday: state.claimedToday, claimed: state.claimed, cycle: 0, total: state.claimed, rewards: REWARDS, nextResetAt: Date.now() + 3600_000 },
      activity: { current: 5, best: 9, activeToday: true, broken: false, restPerWeek: 1, restLeft: 1, milestones: MILESTONES.map(([days, coins, gems, title]) => ({ days, coins, gems, ...(title ? { title } : {}), paid: days <= 7 })) },
      weeklyStreak: { current: 4, best: 4, paidCoins: 15, nextResetAt: Date.now() + 86_400_000, tiers: [{ streak: 3, coins: 15, paid: true }, { streak: 5, coins: 30, paid: false }, { streak: 8, coins: 50, paid: false }] },
    },
    inbox: state.inbox, history: [], redeem: false, wallet: { coins: state.coins, gems: state.gems },
    ...(granted ? { granted, snapshot: { config: "M3i-W30@2", wallet: { coins: state.coins, gems: state.gems }, inventory: [], slots: { emote: 4, chat: 6 }, loadout: DEFAULT_LOADOUT, look: publicLook(DEFAULT_LOADOUT, new Map()), state: { daily: [], weekly: [], counters: {}, achievements: [] }, ledger: [] } } : {}),
  });
  const handle = async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: { ...H, "access-control-allow-headers": "content-type, authorization" } });
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: "application/json", headers: H, body: JSON.stringify(body) });
    if (req.method() === "POST") requests.push({ path: url.pathname, body: req.postDataJSON() });
    if (mode === "off" && url.pathname.startsWith("/api/me/rewards")) return json(404, { error: { code: "RETENTION_OFF", message: "준비 중" } });
    if (url.pathname === "/api/me/rewards") return json(200, view());
    if (url.pathname === "/api/me/rewards/attendance") {
      if (state.claimedToday) return json(409, { error: { code: "ALREADY_CLAIMED", message: "오늘 출석 보상은 이미 받았어요." } });
      const r = REWARDS[state.claimed];
      state.claimed++;
      state.claimedToday = true;
      state.coins += r.coins;
      return json(200, view([{ txId: "att:0:3", source: "attendance", coins: r.coins, gems: r.gems, items: [], label: "출석 3일차", status: "granted", createdAt: 2, expiresAt: null }]));
    }
    if (url.pathname === "/api/me/rewards/claim") {
      const g = state.inbox;
      state.inbox = [];
      state.coins += 300;
      state.gems += 10;
      return json(200, view(g.map((x) => ({ ...x, status: "claimed" }))));
    }
    if (url.pathname === "/api/me/economy") return json(200, { snapshot: view([]).snapshot });
    return json(404, { error: { code: "NOT_FOUND", message: "없음" } });
  };
  return { handle, requests };
}
async function open(page: Page, mode: "on" | "off") {
  const s = server(mode);
  await page.route(SERVER + "/**", s.handle);
  await page.addInitScript((v) => localStorage.setItem("yachtlab.session.v1", v), SESSION);
  await page.goto(`?online-server=${encodeURIComponent(SERVER)}#rewards`);
  return s;
}

test("출석·연속 활동·주간 연승·보상함을 서버 값으로 보여 주고, 출석 수령은 하루 한 번", async ({ page }) => {
  const s = await open(page, "on");
  await expect(page.getByRole("heading", { name: "출석·보상" })).toBeVisible();
  const cells = page.getByRole("list", { name: "출석 보상" }).getByRole("listitem");
  await expect(cells).toHaveCount(7);
  await expect(cells.nth(6)).toContainText("60");
  await expect(page.getByText("현재 5일 · 최고 9일 · 이번 주 휴식 1/1")).toBeVisible();
  await expect(page.getByRole("list", { name: "연속 활동 이정표" })).toContainText("칭호 「한 달 항해사」");
  await expect(page.getByText("현재 4연승 · 최고 4연승 · 받은 15/50코인")).toBeVisible();
  await page.getByRole("button", { name: /오늘 출석 받기 · 15코인/ }).click();
  await expect(page.getByRole("status").filter({ hasText: "15코인을(를) 받았어요." })).toBeVisible();
  await expect(page.getByRole("button", { name: "오늘 출석 완료" })).toBeDisabled();
  expect(s.requests.filter((r) => r.path === "/api/me/rewards/attendance")).toHaveLength(1);
  // no amount is ever sent by the page
  expect(JSON.stringify(s.requests)).not.toMatch(/coins|gems/);
});

test("보상함 받기와 교환 코드(준비 중이면 입력 비활성)", async ({ page }) => {
  const s = await open(page, "on");
  const inbox = page.getByRole("list", { name: "받을 보상" });
  await expect(inbox).toContainText("제안 채택 보상");
  await inbox.getByRole("button", { name: "받기" }).click();
  await expect(page.getByText("받을 보상이 없어요.")).toBeVisible();
  expect(s.requests.find((r) => r.path === "/api/me/rewards/claim")?.body).toEqual({ txId: "sug:s-1" });
  await expect(page.getByRole("textbox", { name: "교환 코드" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "사용" })).toBeDisabled();
});

test("Worker에서 보상이 꺼져 있으면 준비 중 안내만 보이고 요청을 보내지 않는다", async ({ page }) => {
  const s = await open(page, "off");
  await expect(page.getByText("출석·연속 활동 보상은 준비 중이에요.")).toBeVisible();
  await expect(page.getByRole("button", { name: /출석/ })).toHaveCount(0);
  expect(s.requests).toEqual([]);
});

test("휴대폰 폭에서 가로로 넘치지 않는다", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await open(page, "on");
  await expect(page.getByRole("list", { name: "출석 보상" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});

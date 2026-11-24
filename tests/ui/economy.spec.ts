import { expect, test, type Page, type Route } from "@playwright/test";
import { DEFAULT_LOADOUT, publicLook } from "../../src/economy/live/catalog";

/**
 * Shop / inventory / quests / achievements pages. The server is replaced by `page.route` with a small
 * in-memory account (the real server logic is covered by tests/economy-live.test.ts and the
 * wrangler end-to-end test tests/economy-worker.test.ts): this checks what the pages show and send.
 */
const SERVER = "http://127.0.0.1:8799";
const SESSION = "s1.u_" + "a".repeat(22) + "." + "b".repeat(43);
type Snap = Record<string, any>;
function account() {
  const snap: Snap = {
    config: "M3i-W30@1",
    wallet: { coins: 1500, gems: 30 },
    inventory: [] as { id: string; level: number; via: string; at: number }[],
    slots: { emote: 4, chat: 6 },
    loadout: { ...DEFAULT_LOADOUT },
    look: publicLook(DEFAULT_LOADOUT, new Map()),
    state: {
      day: 1, week: 1, rerolls: 0, rewarded: 2, streak: 1, dailyAll: false, weeklyAll: false,
      daily: [{ id: "d.play3", progress: 2, done: false }, { id: "d.win1", progress: 1, done: true }, { id: "d.yacht1", progress: 0, done: false }],
      weekly: [{ id: "w.play15", progress: 4, done: false }, { id: "w.win7", progress: 2, done: false }, { id: "w.yacht4", progress: 0, done: false }],
      counters: { match: 12, win: 6, yacht: 1, best: 214 }, achievements: ["a.match.10", "a.yacht.1", "s.200"],
    },
    ledger: [{ id: "q:daily:1:d.win1", at: 1, kind: "quest", coins: 20, gems: 0, coinsAfter: 1500, gemsAfter: 30, label: "일일 퀘스트 · 1승" }],
  };
  const requests: Record<string, any>[] = [];
  const handle = async (route: Route) => {
    const url = new URL(route.request().url());
    const body = route.request().postDataJSON?.() ?? null;
    if (body) requests.push({ path: url.pathname, ...body });
    const ok = () => route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ snapshot: snap }) });
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type, authorization" } });
    if (url.pathname === "/api/me/economy") return ok();
    if (url.pathname === "/api/me/shop/buy") {
      const price = body.itemId === "dice.mint" ? (body.currency === "coins" ? 300 : 40) : 0;
      snap.wallet = { ...snap.wallet, [body.currency]: snap.wallet[body.currency] - price };
      snap.inventory = [...snap.inventory, { id: body.itemId, level: 1, via: body.currency, at: 2 }];
      return ok();
    }
    if (url.pathname === "/api/me/loadout") {
      snap.loadout = body.loadout;
      return ok();
    }
    if (url.pathname === "/api/me/quests/reroll") {
      snap.state = { ...snap.state, rerolls: 1, daily: snap.state.daily.map((q: any, i: number) => (i === body.index ? { id: "d.win2", progress: 0, done: false } : q)) };
      return ok();
    }
    return route.fulfill({ status: 404, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ error: { code: "NOT_FOUND", message: "없음" } }) });
  };
  return { snap, requests, handle };
}
async function open(page: Page, hash: string) {
  const acc = account();
  await page.route(SERVER + "/**", acc.handle);
  await page.addInitScript((s) => localStorage.setItem("yachtlab.session.v1", s), SESSION);
  await page.goto(`?online-server=${encodeURIComponent(SERVER)}#${hash}`);
  return acc;
}

test("홈 메뉴에 상점·인벤토리·퀘스트·업적·프로필이 있다", async ({ page }) => {
  await page.goto("#home");
  const menu = page.getByRole("navigation", { name: "내 메뉴" });
  for (const name of ["상점", "인벤토리", "퀘스트", "업적", "프로필"]) await expect(menu.getByRole("button", { name })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("로그인 전에는 상점이 로그인을 안내한다(가짜 잔액 없음)", async ({ page }) => {
  await page.goto(`?online-server=${encodeURIComponent(SERVER)}#shop`);
  await expect(page.getByText("로그인한 회원의 서버 검증 경기로만")).toBeVisible();
  await expect(page.getByTestId("coins")).toHaveText("–");
});

test("상점: 잔액·필터·코인/보석 가격·업적 전용 표시, 구매 요청은 요청 ID와 함께 보내고 보유 표시가 바뀐다", async ({ page }) => {
  const acc = await open(page, "shop");
  await expect(page.getByTestId("coins")).toHaveText("1,500");
  await expect(page.locator('[data-item="title.300"]')).toContainText("업적 보상");
  await expect(page.locator('[data-item="dice.royal"]').getByRole("button", { name: /코인 25000/ })).toBeDisabled(); // not enough coins
  await page.getByLabel("상품군").selectOption("dice");
  await expect(page.locator(".shop-item")).toHaveCount(4);
  await page.getByRole("button", { name: "민트 코인 300으로 구매" }).click();
  await expect(page.locator('[data-item="dice.mint"]')).toContainText("보유 중");
  await expect(page.getByTestId("coins")).toHaveText("1,200");
  expect(acc.requests.at(-1)).toMatchObject({ path: "/api/me/shop/buy", itemId: "dice.mint", currency: "coins", requestId: expect.stringMatching(/^[A-Za-z0-9_-]{8,}$/) });
  await expect(page.getByRole("button", { name: "이모티콘 슬롯 코인 구매" })).toBeVisible();
});

test("인벤토리: 기본 이모티콘 4·채팅 6 장착, 슬롯 한도, 순서 변경 후 저장", async ({ page }) => {
  const acc = await open(page, "inventory");
  await expect(page.getByText("이모티콘 장착 4/4")).toBeVisible();
  await expect(page.getByText("채팅 장착 6/6")).toBeVisible();
  const order = page.getByRole("list", { name: "이모티콘 순서" });
  await expect(order.locator("li")).toHaveCount(4);
  await order.locator("li").nth(1).getByRole("button", { name: "앞으로" }).click();
  await page.getByRole("button", { name: "장착 저장" }).click();
  await expect(page.getByText("장착을 저장했어요")).toBeVisible();
  expect(acc.requests.at(-1)!.loadout.emotes).toEqual(["emote.party", "emote.smile", "emote.clap", "emote.thumbs_up"]);
});

test("퀘스트: 진행도·보상·초기화 시각·하루 1회 교체·받은 보상 내역 / 업적: 달성·숨김", async ({ page }) => {
  await open(page, "quests");
  await expect(page.getByText("경기 3회 완료")).toBeVisible();
  await expect(page.getByText("2/3 · 15코인")).toBeVisible();
  await expect(page.getByText(/뒤 초기화 · 매일 00:00\(한국 시간\)/)).toBeVisible();
  await page.getByRole("button", { name: "요트 기록 교체" }).click();
  await expect(page.getByText("2승")).toBeVisible();
  await expect(page.getByRole("button", { name: /교체$/ })).toHaveCount(0);
  await expect(page.getByRole("list", { name: "재화 내역" })).toContainText("+20코인");
  await page.goto(`?online-server=${encodeURIComponent(SERVER)}#achievements`);
  await expect(page.getByText("달성 3 /")).toBeVisible();
  await expect(page.getByText("???").first()).toBeVisible();
  await expect(page.getByText("300점 이상")).toHaveCount(0);
});

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
    if (url.pathname === "/api/me/economy" || url.pathname === "/api/me/logout") return ok();
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
  await page.getByRole("button", { name: "메뉴", exact: true }).click();
  const menu = page.getByRole("navigation", { name: "주요 메뉴" });
  for (const name of ["게임", "활동", "아이템"]) await expect(menu.getByRole("region", { name })).toBeVisible();
  for (const name of ["상점", "인벤토리", "퀘스트", "업적"]) await expect(menu.getByRole("button", { name })).toBeVisible();
  await expect(menu.getByRole("button", { name: "홈", exact: true })).toHaveAttribute("aria-current", "page");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("로그인 전에는 상점이 로그인을 안내한다(가짜 잔액 없음)", async ({ page }) => {
  await page.goto(`?online-server=${encodeURIComponent(SERVER)}#shop`);
  await expect(page.getByText("로그인한 회원의 서버 검증 경기로만")).toBeVisible();
  await expect(page.getByTestId("coins")).toHaveText("–");
});

test("상점: 가로 상품 목록·상품군 탭·등급/가격 필터·업적 전용 표시, 상세에서 미리보기 후 확인을 거쳐 구매(요청 ID)", async ({ page }) => {
  const acc = await open(page, "shop");
  await expect(page.getByTestId("coins")).toHaveText("1,500");
  await expect(page.getByRole("tab", { name: "둘러보기" })).toHaveAttribute("aria-selected", "true");
  const diceSection = page.getByRole("region", { name: "주사위" });
  const rail = diceSection.getByRole("list", { name: "주사위 상품" });
  await expect(rail.locator(".item-card")).toHaveCount(29);
  await diceSection.getByRole("button", { name: "주사위 다음 상품" }).click();
  await expect.poll(() => rail.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);
  await expect(page.getByRole("button", { name: /더 보기/ })).toHaveCount(0);
  await page.getByRole("tab", { name: /^주사위/ }).click();
  await expect(page.getByRole("tab", { name: /^주사위/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".item-card")).toHaveCount(29); // every dice design for sale
  await expect(page.locator('[data-item="dice.royal"] .item-card-price .short').first()).toBeVisible(); // not affordable
  await page.getByLabel("등급").selectOption("common");
  await expect(page.locator(".item-card")).toHaveCount(6);
  await page.getByLabel("가격").selectOption("afford");
  await expect(page.locator(".item-card")).toHaveCount(6);
  await page.getByLabel("등급").selectOption("all");
  await page.getByLabel("가격").selectOption("all");
  await page.getByRole("tab", { name: /^칭호/ }).click();
  await expect(page.locator('[data-item="title.300"]')).toContainText("업적 보상");
  await page.getByRole("tab", { name: /^주사위/ }).click();
  // detail: preview first (nothing is sent), then buy with a confirmation
  const before = acc.requests.length;
  await page.getByRole("button", { name: "민트 자세히" }).click();
  const dialog = page.getByRole("dialog", { name: "민트 상세" });
  await expect(dialog.getByRole("button", { name: "굴려 보기" })).toBeVisible();
  await dialog.getByRole("button", { name: "굴려 보기" }).click();
  expect(acc.requests.length).toBe(before);
  await dialog.getByRole("button", { name: "민트 코인 300으로 구매" }).click();
  await expect(page.getByRole("dialog", { name: "구매할까요?" })).toBeVisible();
  await page.getByRole("button", { name: "구매", exact: true }).click();
  await expect(page.locator('[data-item="dice.mint"]')).toContainText("보유 중");
  await expect(page.getByTestId("coins")).toHaveText("1,200");
  await expect(page.locator(".top-wallet")).toContainText("1,200");
  expect(acc.requests.at(-1)).toMatchObject({ path: "/api/me/shop/buy", itemId: "dice.mint", currency: "coins", requestId: expect.stringMatching(/^[A-Za-z0-9_-]{8,}$/) });
  await expect(page.getByRole("button", { name: "이모티콘 슬롯 코인 구매" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("상점: 강화형 상품은 사기 전에 Lv.1~3 차이를 미리 보고, 잔액이 부족해도 미리보기는 열린다", async ({ page }) => {
  await open(page, "shop");
  await page.getByRole("tab", { name: /^주사위/ }).click();
  await page.getByRole("button", { name: "황금 자세히" }).click();
  const dialog = page.getByRole("dialog", { name: "황금 상세" });
  await expect(dialog.getByRole("tab")).toHaveCount(3);
  await dialog.getByRole("tab", { name: "Lv.3" }).click();
  await expect(dialog.getByText("Lv.3 · 움직이는 빛")).toBeVisible();
  await expect(dialog.getByText("재화가 부족해요. 미리보기는 그대로 볼 수 있어요.")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: /^닉네임 효과/ }).click();
  await page.getByRole("button", { name: "오로라 자세히" }).click();
  const nf = page.getByRole("dialog", { name: "오로라 상세" });
  await nf.getByRole("tab", { name: "Lv.2" }).click();
  await expect(nf.locator(".profile-card-sample .player-name")).toHaveClass(/namefx-aurora fx-lv2/);
  await nf.getByRole("button", { name: "같은 등급 상품 보기" }).click();
  await expect(page.getByLabel("등급")).not.toHaveValue("all");
  await expect(page.getByRole("list", { name: "닉네임 효과 상품" })).toBeVisible();
});

test("인벤토리: 장착 미리보기·상품군 탭·기본 이모티콘 4·채팅 6, 순서 변경 후 저장", async ({ page }) => {
  const acc = await open(page, "inventory");
  await expect(page.getByRole("region", { name: "장착 미리보기" }).or(page.locator(".loadout-preview"))).toBeVisible();
  await page.getByRole("tab", { name: /^이모티콘/ }).click();
  await expect(page.getByText("이모티콘 장착 4/4")).toBeVisible();
  const order = page.getByRole("list", { name: "이모티콘 순서" });
  await expect(order.locator("li")).toHaveCount(4);
  await order.locator("li").nth(1).getByRole("button", { name: "앞으로" }).click();
  await page.getByRole("tab", { name: /^채팅/ }).click();
  await expect(page.getByText("채팅 장착 6/6")).toBeVisible();
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

test("회원 홈에서 서버가 반환한 잔액과 장착 외형을 보여 준다", async ({ page }) => {
  const acc = await open(page, "home");
  acc.snap.look = { ...acc.snap.look, nameFx: "nameFx.aurora", nameFxLv: 2, title: "title.300" };
  await page.reload();
  await expect(page.locator(".top-wallet")).toContainText("1,500");
  await expect(page.locator(".top-wallet")).toContainText("30");
  await page.getByRole("button", { name: "프로필 메뉴" }).click();
  const account = page.locator(".top-profile-panel");
  await expect(account.getByRole("button", { name: "계정 설정" })).toBeVisible();
  await expect(account.getByRole("button", { name: "로그아웃" })).toBeVisible();
  await expect(account.locator(".player-icon")).toBeVisible();
  await expect(account.locator(".player-name")).toHaveClass(/namefx-aurora fx-lv2/);
  await expect(account.locator(".player-title")).toBeVisible();
});

test("게스트 홈에 계정 안내가 있고 휴대폰에서는 주요 메뉴로 이동할 수 있다", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("#home");
  const profile = page.getByRole("button", { name: "프로필 메뉴" });
  await profile.focus();
  await page.keyboard.press("Enter");
  const account = page.locator(".top-profile-panel");
  await expect(account.locator(".player-name")).toContainText("요트러");
  await expect(account.locator(".player-icon")).toBeVisible();
  await expect(page.locator(".top-wallet")).toHaveCount(0);
  await page.keyboard.press("Tab");
  await expect(account.getByRole("button", { name: "내 프로필" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(profile).toBeFocused();
  await profile.click();
  await account.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page.getByRole("region", { name: "로그인" })).toBeVisible();
  await page.getByRole("button", { name: "메뉴", exact: true }).click();
  const menu = page.getByRole("dialog", { name: "메뉴" });
  await menu.getByRole("button", { name: "퀘스트" }).click();
  await expect(page).toHaveURL(/#quests$/);
  await expect(menu).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("계정 세션 변경과 로그아웃 후에도 최초 방문 튜토리얼이 다시 열리지 않는다", async ({ page }) => {
  const acc = account();
  await page.route(SERVER + "/**", acc.handle);
  await page.goto(`?online-server=${encodeURIComponent(SERVER)}#home`);
  await page.evaluate((session) => localStorage.setItem("yachtlab.session.v1", session), SESSION);
  await page.reload();
  const profile = page.getByRole("button", { name: "프로필 메뉴" });
  const menu = page.locator(".top-profile-panel");
  await expect(page.locator(".top-wallet")).toContainText("1,500");
  await profile.click();
  await page.getByRole("button", { name: "계정 설정" }).click();
  await expect(page).toHaveURL(/#account$/);
  await profile.click();
  await menu.getByRole("button", { name: "로그아웃", exact: true }).click();
  await expect(page.locator(".top-wallet")).toHaveCount(0);
  expect(acc.requests.at(-1)?.path).toBe("/api/me/logout");
  await page.reload();
  await expect(page.getByRole("region", { name: "튜토리얼" })).toHaveCount(0);
  await profile.click();
  await expect(menu.getByRole("button", { name: "로그인", exact: true })).toBeVisible();
});

test("설치 팝업은 긴 회원 닉네임과 잔액이 있는 320~430px 홈을 밀지 않는다", async ({ page }) => {
  for (const width of [320, 375, 430]) {
    await page.setViewportSize({ width, height: 760 });
    const acc = await open(page, "home");
    acc.snap.wallet.coins = 987_654_321;
    acc.snap.wallet.gems = 123_456_789;
    await page.evaluate(() => localStorage.setItem("yachtlab.online.name", "ABCDEFGH요트선수"));
    await page.reload();
    const profile = page.getByRole("button", { name: "프로필 메뉴" });
    await expect(page.locator(".top-wallet")).toContainText("987,654,321");
    const before = await profile.boundingBox();
    await page.evaluate(() => {
      const offer = new Event("beforeinstallprompt", { cancelable: true });
      Object.assign(offer, { prompt: async () => {}, userChoice: Promise.resolve({ outcome: "accepted" }) });
      window.dispatchEvent(offer);
    });
    const popup = page.getByRole("complementary", { name: "앱 설치" });
    await expect(popup).toBeVisible();
    expect(await profile.boundingBox()).toEqual(before);
    expect((await popup.boundingBox())!.y).toBeGreaterThanOrEqual(before!.y + before!.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await profile.click();
    await page.locator(".top-profile-panel").getByRole("button", { name: "계정 설정" }).click({ trial: true });
    await page.keyboard.press("Escape");
    await popup.getByRole("button", { name: "설치 안내 닫기" }).click();
    await expect(popup).toHaveCount(0);
    await page.evaluate(() => localStorage.removeItem("yachtlab.install-dismissed.v1"));
  }
});

test("보드 미리보기는 실제 굴림 면에 소재가 적용되고 킵한 눈을 유지한다", async ({ page }) => {
  const account = await open(page, "shop");
  await page.getByRole("tab", { name: /^보드판/ }).click();
  await page.getByRole("button", { name: "오로라 자세히" }).click();
  const dialog = page.getByRole("dialog", { name: "오로라 상세" });
  const board = dialog.getByRole("region", { name: "미리보기 보드" });
  await expect(board).toHaveClass(/bd-aurora/);
  await dialog.getByRole("tab", { name: "Lv.3" }).click();
  await expect(board).toHaveClass(/bd-aurora bd-lv3 bd-static/);
  const tray = board.locator(".dice-row");
  await expect(tray).toHaveCSS("background-image", /radial-gradient/);
  await dialog.getByRole("button", { name: "굴려 보기" }).click();
  const die = board.getByRole("button", { name: /^주사위 1,/ });
  await die.click();
  await expect(die).toHaveAttribute("aria-pressed", "true");
  const kept = await die.getAttribute("aria-label");
  await dialog.getByRole("button", { name: "굴려 보기" }).click();
  await expect(die).toHaveAttribute("aria-label", kept!);
  await dialog.getByRole("button", { name: "족보 효과 보기" }).click();
  await expect(board.locator(".score-fx-label")).toContainText("라지 스트레이트");
  expect(account.requests).toHaveLength(0);
});

test("상점 미리보기는 소재별 굴림 소리와 강화 전 이모티콘 효과음을 사용한다", async ({ page }) => {
  const account = await open(page, "shop");
  await page.getByRole("tab", { name: /^주사위/ }).click();
  await page.getByRole("button", { name: "황금 자세히" }).click();
  await page.getByRole("button", { name: "굴려 보기" }).click();
  const sound = () => page.evaluate(() => (window as any).__yachtlabSound.log.map(({ name, pack }: { name: string; pack?: string }) => [name, pack]));
  await expect.poll(sound).toContainEqual(["impact", "gold"]);
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: /^이모티콘/ }).click();
  await page.getByRole("button", { name: "번개 자세히" }).click();
  await page.getByRole("button", { name: "소리 듣기" }).click();
  await expect.poll(sound).toContainEqual(["emote", "bolt"]);
  expect(account.requests).toHaveLength(0);
});

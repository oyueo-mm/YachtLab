import { expect, test, type Page, type Route } from "@playwright/test";
import { DEFAULT_LOADOUT, publicLook } from "../../src/economy/live/catalog";
import { pickOption } from "./helpers";

/**
 * UI-2 (2026-11-28) shop / draw / inventory redesign. The server is a small in-memory mock (same shape as
 * tests/ui/economy.spec.ts); the real economy logic is covered by the worker tests.
 */
const SERVER = "http://127.0.0.1:8799";
const session = (c: string) => "s1.u_" + c.repeat(22) + "." + "b".repeat(43);
type Snap = Record<string, any>;

function account(inventory: { id: string; level: number }[] = [], loadout: Record<string, unknown> = {}) {
  const full = { ...DEFAULT_LOADOUT, ...loadout };
  const snap: Snap = {
    config: "M3i-W30@1", catalogRev: 2, wallet: { coins: 5000, gems: 30 },
    inventory: inventory.map((i, n) => ({ ...i, via: "coins", at: n + 1 })), slots: { emote: 4, chat: 6 },
    loadout: full, look: publicLook(full as typeof DEFAULT_LOADOUT, new Map(inventory.map((i) => [i.id, i.level]))),
    state: { day: 1, week: 1, rerolls: 0, rewarded: 0, streak: 0, dailyAll: false, weeklyAll: false, daily: [], weekly: [], counters: {}, achievements: [] }, ledger: [],
  };
  const requests: Record<string, any>[] = [];
  const handle = async (route: Route) => {
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type, authorization" };
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const url = new URL(route.request().url());
    const body = route.request().postDataJSON?.() ?? null;
    if (body) requests.push({ path: url.pathname, ...body });
    if (url.pathname === "/api/me/loadout") snap.loadout = body.loadout;
    if (url.pathname === "/api/me/shop/upgrade") {
      snap.inventory = snap.inventory.map((i: any) => (i.id === body.itemId ? { ...i, level: i.level + 1 } : i));
      snap.wallet = { ...snap.wallet, coins: snap.wallet.coins - 100 };
    }
    if (!["/api/me/economy", "/api/me/loadout", "/api/me/shop/upgrade"].includes(url.pathname))
      return route.fulfill({ status: 404, contentType: "application/json", headers: cors, body: JSON.stringify({ error: { code: "NOT_FOUND", message: "-" } }) });
    return route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify({ snapshot: snap }) });
  };
  return { snap, requests, handle };
}
async function open(page: Page, hash: string, acc = account(), who = "a") {
  await page.route(SERVER + "/**", acc.handle);
  await page.addInitScript((s) => { if (!localStorage.getItem("yachtlab.session.v1")) localStorage.setItem("yachtlab.session.v1", s); }, session(who));
  await page.goto(`?online-server=${encodeURIComponent(SERVER)}#${hash}`);
  return acc;
}
const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

test("상점 캐러셀: 기존 컬렉션 슬라이드, 화살표·점·키보드 이동, 일시정지, 컬렉션 바로가기 (판매 정책 없음)", async ({ page }) => {
  await page.goto("#shop");
  const promo = page.getByRole("region", { name: "추천 컬렉션" });
  await expect(promo).toBeVisible();
  const slides = promo.locator('[aria-roledescription="slide"]');
  await expect(slides).toHaveCount(11);
  await expect(promo).not.toContainText(/할인|세일|%|묶음/);
  const current = () => promo.locator('.promo-dots [aria-current="true"]').getAttribute("aria-label");
  expect(await current()).toMatch(/^1번째/);
  await promo.getByRole("button", { name: "다음 슬라이드" }).click();
  expect(await current()).toMatch(/^2번째.*번개/);
  await page.keyboard.press("ArrowRight");
  expect(await current()).toMatch(/^3번째.*초원/);
  await promo.getByRole("button", { name: /^11번째/ }).click();
  expect(await current()).toMatch(/오로라/);
  await promo.getByRole("button", { name: "다음 슬라이드" }).click();
  expect(await current()).toMatch(/^1번째/); // wraps around
  // reduced motion (test default): auto-advance starts paused and says so
  await expect(promo.getByRole("button", { name: "자동 넘김 켜기" })).toHaveAttribute("aria-pressed", "true");
  await promo.getByRole("button", { name: /^8번째/ }).click(); // 용암 (1 = 에디터 추천)
  await promo.locator('[aria-roledescription="slide"][aria-hidden="false"]').getByRole("button", { name: "컬렉션 보기" }).click();
  await expect(page.locator(".collection-banner")).toContainText("용암 컬렉션");
  await expect(page.getByRole("list", { name: "검색 결과 상품" }).locator(".item-card")).toHaveCount(3);
  await expect(promo).toHaveCount(0); // results view: no carousel
});

test("상점: 둘러보기(추천·테마·신상품 레일)와 카테고리 전체 그리드 분리, 검색·가격대·정렬·필터 초기화", async ({ page }) => {
  await page.goto("#shop");
  for (const name of ["에디터 추천", "테마 컬렉션", "신상품"]) await expect(page.getByRole("region", { name, exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "에디터 추천", exact: true })).toContainText("이용량이나 개인 데이터 없이");
  await expect(page.getByRole("list", { name: "신상품 상품" }).locator(".item-card")).toHaveCount(11);
  await expect(page.locator(".stage-board")).toHaveCount(0); // no live renderer on the browse page
  await page.getByRole("searchbox", { name: "상품 이름·테마 검색" }).fill("벚꽃");
  const results = page.getByRole("list", { name: "검색 결과 상품" });
  await expect(results.locator('[data-item="dice.sakura"]')).toBeVisible();
  await expect(results.locator('[data-item="board.sakura"]')).toBeVisible();
  await page.getByRole("button", { name: "필터 초기화" }).click();
  await expect(page.getByRole("region", { name: "에디터 추천", exact: true })).toBeVisible();
  await page.getByRole("tab", { name: /^주사위/ }).click();
  await pickOption(page, "정렬", "가격 낮은순");
  const prices = await page.locator(".shop-grid-full .item-card").evaluateAll((cards) => cards.map((c) => c.getAttribute("data-item")));
  expect(prices[0]).not.toMatch(/royal|gold|hologram/);
  await pickOption(page, "가격대", "15,000코인 이상");
  const top = page.getByRole("list", { name: "주사위 상품" }).locator(".item-card");
  await expect(top.first()).toBeVisible();
  for (const id of await top.evaluateAll((cards) => cards.map((c) => c.getAttribute("data-item")))) expect(["dice.royal", "dice.hologram", "dice.gold"]).toContain(id);
  await pickOption(page, "정렬", "신상품순");
  await pickOption(page, "가격대", "모든 가격대");
  await expect(page.locator(".shop-grid-full .item-card").first()).toHaveAttribute("data-item", /dice\.(thunder|meadow|flower|sakura|abyss)/);
  expect(await noOverflow(page)).toBe(true);
});

test("상점 카테고리 사이드바: 9개 상품군 전체 지원, 방향키 이동, 회원 보유 필터와 상세 보유·장착 상태", async ({ page }) => {
  const acc = account([{ id: "dice.mint", level: 1 }], { dice: "dice.mint" });
  await open(page, "shop", acc);
  const nav = page.getByRole("tablist", { name: "상품군" });
  await expect(nav.getByRole("tab")).toHaveCount(10);
  await nav.getByRole("tab", { name: "둘러보기" }).focus();
  await page.keyboard.press("ArrowDown");
  await expect(nav.getByRole("tab", { name: /^주사위/ })).toHaveAttribute("aria-selected", "true");
  for (const label of ["보드판", "이모티콘", "채팅", "말풍선", "프로필", "닉네임 효과", "특수 연출", "칭호"]) {
    await nav.getByRole("tab", { name: new RegExp("^" + label) }).click();
    await expect(page.getByRole("list", { name: label + " 상품" }).locator(".item-card").first()).toBeVisible();
  }
  await nav.getByRole("tab", { name: /^주사위/ }).click();
  await pickOption(page, "보유 상태", "보유만");
  await expect(page.locator(".shop-grid-full .item-card")).toHaveCount(1);
  await expect(page.locator('[data-item="dice.mint"]')).toContainText("장착 중");
  await page.getByRole("button", { name: "민트 자세히" }).click();
  const dialog = page.getByRole("dialog", { name: "민트 상세" });
  await expect(dialog.locator(".item-detail-status")).toContainText("지금 장착 중");
  await expect(dialog.getByRole("button", { name: "소리 듣기" })).toBeVisible();
  await expect(page.locator(".stage-board")).toHaveCount(1); // exactly one live stage
  // match moments through the FxPreview-shaped stage: a yacht / large straight land as real faces
  await dialog.getByRole("button", { name: "요트 연출" }).click();
  await expect(dialog.locator(".yacht-flash")).toBeVisible();
  await dialog.getByRole("button", { name: "스트레이트 연출" }).click();
  await expect(dialog.locator(".straight-flash")).toBeVisible();
  await dialog.getByRole("button", { name: /인벤토리에서/ }).click();
  await expect(page).toHaveURL(/#inventory$/);
  await expect(page.getByRole("dialog", { name: "민트 상세" })).toBeVisible(); // opened in the inventory
});

test("인벤토리: 특수 연출 탭 오류 수정, 슬롯 요약에서 상품군 이동, 검색·보기 필터, 목록에서 강화, 컬렉션 진행도", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const acc = account([{ id: "dice.thunder", level: 1 }, { id: "board.storm", level: 1 }, { id: "fx.confetti", level: 1 }], { dice: "dice.thunder", board: "board.storm" });
  await open(page, "inventory", acc);
  const slots = page.getByRole("list", { name: "장착한 아이템" });
  await slots.getByRole("button", { name: /^특수 연출: 기본 연출/ }).click();
  await expect(page.getByRole("tab", { name: /^특수 연출/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("list", { name: "보유 아이템" }).locator(".item-card")).toHaveCount(2);
  await expect(page.locator('[data-item="fx.none"]')).toContainText("기본 연출");
  await page.getByRole("button", { name: "기본 연출 자세히" }).click();
  await expect(page.getByRole("dialog", { name: "기본 연출 상세" }).getByRole("img", { name: "기본 연출 미리보기" })).toBeVisible();
  await page.keyboard.press("Escape");
  expect(errors).toEqual([]);
  await expect(page.locator(".collection-banner.active")).toContainText("번개 시너지 켜짐");
  await page.getByRole("tab", { name: /^주사위/ }).click();
  await pickOption(page, "보기", "장착 안 함");
  await expect(page.getByRole("list", { name: "보유 아이템" }).locator(".item-card")).toHaveCount(1); // the classic die
  await pickOption(page, "보기", "강화 가능");
  await page.getByRole("button", { name: /번개 목록에서 Lv\.2로 강화/ }).click();
  await page.getByRole("dialog", { name: "강화할까요?" }).getByRole("button", { name: "강화", exact: true }).click();
  await expect(page.getByText("번개 Lv.2 강화 완료")).toBeVisible();
  expect(acc.requests.at(-1)).toMatchObject({ path: "/api/me/shop/upgrade", itemId: "dice.thunder" });
  const progress = page.getByRole("region", { name: "컬렉션 진행도" });
  await expect(progress.locator("li").filter({ hasText: "번개" })).toContainText("2/3");
  await progress.getByRole("button", { name: "번개 컬렉션 상점에서 보기" }).click();
  await expect(page).toHaveURL(/#shop$/);
  await expect(page.locator(".collection-banner")).toContainText("번개 컬렉션");
  expect(await noOverflow(page)).toBe(true);
});

test("인벤토리 장착 프리셋: 기기에만 저장, 불러올 때 소유 검증, 계정마다 분리, 저장은 서버 검증", async ({ page }) => {
  const acc = account([{ id: "dice.thunder", level: 1 }, { id: "board.storm", level: 1 }], { dice: "dice.thunder", board: "board.storm" });
  await open(page, "inventory", acc);
  const presets = page.getByRole("region", { name: /장착 프리셋/ });
  await expect(presets).toContainText("계정 동기화 없음");
  await presets.getByRole("textbox", { name: "새 프리셋 이름" }).fill("번개 세트");
  await presets.getByRole("button", { name: "프리셋으로 저장" }).click();
  await expect(presets.getByText("번개 세트", { exact: true })).toBeVisible();
  // change the loadout, then load the preset back (a draft only — nothing sent yet)
  const before = acc.requests.length;
  await page.getByRole("list", { name: "장착한 아이템" }).getByRole("button", { name: /^주사위/ }).click();
  await page.getByRole("button", { name: "클래식 장착" }).click();
  await expect(page.getByText("저장하지 않은 변경이 있어요")).toBeVisible();
  await presets.getByRole("button", { name: "번개 세트 프리셋 불러오기" }).click();
  await expect(presets).toContainText("‘번개 세트’ 프리셋을 불러왔어요");
  expect(acc.requests.length).toBe(before);
  // the player no longer owns the die: the preset falls back through validateLoadout
  acc.snap.inventory = acc.snap.inventory.filter((i: any) => i.id !== "dice.thunder");
  acc.snap.loadout = { ...DEFAULT_LOADOUT };
  await page.reload();
  await presets.getByRole("button", { name: "번개 세트 프리셋 불러오기" }).click();
  await expect(presets).toContainText("보유하지 않은 아이템");
  await page.getByRole("button", { name: "장착 저장" }).click();
  await expect(page.getByText("장착을 저장했어요")).toBeVisible();
  expect(acc.requests.at(-1)).toMatchObject({ path: "/api/me/loadout", loadout: { dice: "dice.classic", board: "board.storm" } });
  // another account on the same device does not see these presets
  const stored = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("yachtlab.loadout-presets.v1:")));
  expect(stored).toEqual(["yachtlab.loadout-presets.v1:u_" + "a".repeat(22)]);
  await page.evaluate((s) => localStorage.setItem("yachtlab.session.v1", s), session("c"));
  await page.reload();
  await expect(page.getByRole("region", { name: /장착 프리셋/ })).not.toContainText("번개 세트");
});

test("뽑기: 독립 화면에 비용·횟수·등급별 확률, 결과 공개와 중복 처리 표시 (정책 불변)", async ({ page }) => {
  const acc = account();
  await page.addInitScript((s) => localStorage.setItem("yachtlab.session.v1", s), session("a"));
  const at = Date.parse("2026-12-10T12:00:00+09:00");
  let receipt: Record<string, unknown> | undefined;
  await page.route(SERVER + "/**", async (route) => {
    if (!route.request().url().endsWith("/api/me/shop/draw") || route.request().method() === "OPTIONS") return acc.handle(route);
    if (route.request().method() === "POST") {
      const { requestId } = route.request().postDataJSON();
      receipt = { requestId, pool: "standard", at, hand: "pair", dice: [3, 3, 5, 1, 6], itemId: "dice.mint", duplicateCoins: 25, cost: 250 };
    }
    return route.fulfill({ headers: { "access-control-allow-origin": "*" }, json: { snapshot: acc.snap, draw: { now: at, remaining: receipt ? 4 : 5, history: receipt ? [receipt] : [] }, ...(receipt ? { receipt } : {}) } });
  });
  await page.goto(`?online-server=${encodeURIComponent(SERVER)}#draw`);
  await expect(page.getByRole("heading", { name: "뽑기", level: 1 })).toBeVisible();
  const intro = page.locator(".draw-intro");
  await expect(intro).toContainText("250코인");
  await expect(intro).toContainText("하루 5회");
  await expect(intro).toContainText("중복 25코인");
  await expect(page.getByRole("list", { name: "등급별 확률" })).toContainText("0.077%"); // mythic = yacht 6/7776
  await page.getByRole("button", { name: "250코인으로 1회 뽑기" }).click();
  await page.getByRole("dialog", { name: "주사위를 굴릴까요?" }).getByRole("button", { name: "뽑기", exact: true }).click();
  const result = page.locator(".draw-result");
  await expect(result).toContainText("민트");
  await expect(result).toContainText("이미 보유 · 25코인으로 지급");
  await expect(result).toHaveClass(/duplicate/);
  expect(await noOverflow(page)).toBe(true);
});

test("반응형: 320~1920px에서 가로 넘침 없이 상점·인벤토리·뽑기를 표시하고, PC는 사이드바·모바일은 칩 줄", async ({ page }) => {
  await open(page, "shop", account([{ id: "dice.mint", level: 1 }]));
  for (const width of [320, 390, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    for (const hash of ["shop", "inventory", "draw"]) {
      await page.goto(`?online-server=${encodeURIComponent(SERVER)}#${hash}`);
      await expect(page.locator(".items-hub")).toBeVisible();
      if (hash !== "draw") await expect(page.getByRole("tablist", { name: "상품군" })).toBeVisible();
      expect(await noOverflow(page), `${hash} @ ${width}px`).toBe(true);
    }
    await page.goto(`?online-server=${encodeURIComponent(SERVER)}#shop`);
    const nav = page.getByRole("tablist", { name: "상품군" });
    const box = (await nav.boundingBox())!;
    if (width > 1000) expect(box.height).toBeGreaterThan(box.width); // vertical sidebar
    else expect(box.width).toBeGreaterThan(box.height); // chip row
  }
});

test("카드 썸네일: 비동기 정지 이미지 공급자(FX-1 loadDiceThumbnail 자리)는 화면 안 카드만 요청하고, 그 전까지 2D 썸네일을 유지한다", async ({ page }) => {
  await page.goto("#shop");
  await page.getByRole("tab", { name: /^주사위/ }).click();
  // 2D first; after INT-1 the real FX-1 still provider (src/shell/shop/fx1-stills.ts) may already have replaced it
  await expect(page.locator('[data-item="dice.mint"] canvas.dice-face-thumb, [data-item="dice.mint"] img.item-thumb-still').first()).toBeVisible();
  await page.evaluate(() => {
    (window as any).__stillRequests = [];
    (window as any).__yachtlabPreview.register({
      id: "test-stills", categories: ["dice"],
      thumbnailAsync: async (item: { id: string }, level: number, px: number) => {
        (window as any).__stillRequests.push(`${item.id}@${level}/${px}`);
        const c = document.createElement("canvas"); c.width = c.height = px;
        const g = c.getContext("2d")!; g.fillStyle = "#123456"; g.fillRect(0, 0, px, px);
        return c.toDataURL();
      },
    });
  });
  await page.getByRole("tab", { name: /^보드판/ }).click(); // remount the grid so cards pick the provider up
  await page.getByRole("tab", { name: /^주사위/ }).click();
  await expect(page.locator('[data-item="dice.mint"] img.item-thumb-still')).toBeVisible();
  const requested: string[] = await page.evaluate(() => (window as any).__stillRequests);
  expect(requested).toContain("dice.mint@1/152");
  expect(requested.length).toBeLessThan(34); // only cards near the viewport, not all 34 dice
  await expect(page.locator(".stage-board")).toHaveCount(0); // still no live renderer on the grid
});


test("409 거절(가격·단계 변경): 상세 창 안에 서버 문구를 보이고, 보유·잔액을 바꾸지 않으며, 최신 스냅숏을 다시 불러온다", async ({ page }) => {
  const acc = account([{ id: "dice.thunder", level: 1 }]);
  let economyLoads = 0;
  page.on("request", (r) => r.method() === "GET" && r.url().endsWith("/api/me/economy") && economyLoads++);
  await open(page, "shop", acc);
  // registered after the account mock: the most recent route wins
  await page.route(SERVER + "/api/me/shop/**", (route) => {
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type, authorization" };
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const path = new URL(route.request().url()).pathname;
    const error = path.endsWith("/buy") ? { code: "PRICE_CHANGED", message: "가격이 바뀌었어요. 새 가격을 확인해 주세요." } : { code: "LEVEL_CHANGED", message: "이미 강화된 상품이에요. 보유 단계를 확인해 주세요." };
    return route.fulfill({ status: 409, contentType: "application/json", headers: cors, body: JSON.stringify({ error }) });
  });
  await page.getByRole("tab", { name: /^주사위/ }).click();
  await page.getByRole("button", { name: "민트 자세히" }).click();
  const dialog = page.getByRole("dialog", { name: "민트 상세" });
  const before = economyLoads;
  await dialog.getByRole("button", { name: /민트 코인 \d+으로 구매/ }).click();
  await page.getByRole("dialog", { name: "구매할까요?" }).getByRole("button", { name: "구매", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveText("가격이 바뀌었어요. 새 가격을 확인해 주세요.");
  await expect.poll(() => economyLoads).toBeGreaterThan(before);
  await expect(page.getByTestId("coins")).toHaveText("5,000");
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-item="dice.mint"]')).not.toContainText("보유 중");
  // upgrade refused from the inventory list (the same confirm path as the detail)
  await page.goto(`?online-server=${encodeURIComponent(SERVER)}#inventory`);
  await page.getByRole("button", { name: /번개 목록에서 Lv\.2로 강화/ }).click();
  await page.getByRole("dialog", { name: "강화할까요?" }).getByRole("button", { name: "강화", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("이미 강화된 상품이에요. 보유 단계를 확인해 주세요.");
  await expect(page.locator('[data-item="dice.thunder"]')).toContainText("Lv.1/3");
});

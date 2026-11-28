import { expect, test, type Route } from "@playwright/test";
import { DEFAULT_LOADOUT, publicLook } from "../../src/economy/live/catalog";
import { drawOdds } from "../../src/economy/live/draw";

/**
 * INT-1 check for UI-2 × C5 (#140): the redesigned shop / inventory / draw keep the economy guards —
 * quote fields on every charge, 409 refusals shown, odds-version mismatch blocks a draw, C5 streak titles
 * are never purchasable or drawable. Run after merging both branches.
 */
const SERVER = "http://127.0.0.1:8799";
const SESSION = "s1.u_" + "a".repeat(22) + "." + "b".repeat(43);
test.beforeEach(({}, info) => test.skip(info.project.name === "mobile", "data paths: one viewport"));

function setup(inventory: { id: string; level: number }[] = [], odds?: string) {
  const snap: Record<string, any> = { config: "M3i-W30@1", catalogRev: 3, wallet: { coins: 50000, gems: 900 }, inventory: inventory.map((i, n) => ({ ...i, via: "coins", at: n + 1 })), slots: { emote: 4, chat: 6 }, loadout: { ...DEFAULT_LOADOUT }, look: publicLook(DEFAULT_LOADOUT, new Map()),
    state: { day: 1, week: 1, rerolls: 0, rewarded: 0, streak: 0, dailyAll: false, weeklyAll: false, daily: [], weekly: [], counters: {}, achievements: [] }, ledger: [] };
  const bodies: Record<string, any>[] = [];
  const handle = (route: Route) => {
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type, authorization" };
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const path = new URL(route.request().url()).pathname;
    const body = route.request().postDataJSON?.() ?? null;
    if (body) bodies.push({ path, ...body });
    if (path === "/api/me/shop/draw") return route.fulfill({ headers: cors, json: { snapshot: snap, draw: { now: Date.now(), remaining: 5, history: [], ...(odds ? { odds: { standard: odds } } : {}) } } });
    if (["/api/me/economy", "/api/me/shop/buy", "/api/me/shop/upgrade", "/api/me/shop/slot"].includes(path)) return route.fulfill({ headers: cors, json: { snapshot: snap } });
    return route.fulfill({ status: 404, headers: cors, json: { error: { code: "NOT_FOUND", message: "-" } } });
  };
  return { snap, bodies, handle };
}

test("구매·슬롯·강화·뽑기 요청에 expectedPrice/expectedLevel/configVersion/oddsVersion이 실린다", async ({ page }) => {
  const s = setup([{ id: "dice.thunder", level: 1 }], drawOdds("standard").version);
  await page.route(SERVER + "/**", s.handle);
  await page.addInitScript((v) => localStorage.setItem("yachtlab.session.v1", v), SESSION);
  await page.goto(`?online-server=${encodeURIComponent(SERVER)}#shop`);
  await page.getByRole("tab", { name: /^주사위/ }).click();
  await page.getByRole("button", { name: "민트 자세히" }).click();
  await page.getByRole("dialog", { name: "민트 상세" }).getByRole("button", { name: /민트 코인 \d+으로 구매/ }).click();
  await page.getByRole("dialog", { name: "구매할까요?" }).getByRole("button", { name: "구매", exact: true }).click();
  await expect.poll(() => s.bodies.find((b) => b.path === "/api/me/shop/buy")).toMatchObject({ itemId: "dice.mint", currency: "coins", expectedPrice: 300, configVersion: "M3i-W30@1" });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "이모티콘 슬롯 코인 구매" }).click();
  await expect.poll(() => s.bodies.find((b) => b.path === "/api/me/shop/slot")).toMatchObject({ kind: "emote", currency: "coins", expectedPrice: 500, configVersion: "M3i-W30@1" });
  await page.goto(`?online-server=${encodeURIComponent(SERVER)}#inventory`);
  await page.getByRole("button", { name: /번개 목록에서 Lv\.2로 강화/ }).click();
  await page.getByRole("dialog", { name: "강화할까요?" }).getByRole("button", { name: "강화", exact: true }).click();
  await expect.poll(() => s.bodies.find((b) => b.path === "/api/me/shop/upgrade")).toMatchObject({ itemId: "dice.thunder", expectedLevel: 1, configVersion: "M3i-W30@1", expectedPrice: expect.any(Number) });
  await page.goto(`?online-server=${encodeURIComponent(SERVER)}#draw`);
  await page.getByRole("button", { name: "250코인으로 1회 뽑기" }).click();
  await page.getByRole("dialog", { name: "주사위를 굴릴까요?" }).getByRole("button", { name: "뽑기", exact: true }).click();
  await expect.poll(() => s.bodies.find((b) => b.path === "/api/me/shop/draw")).toMatchObject({ pool: "standard", expectedPrice: 250, oddsVersion: drawOdds("standard").version, configVersion: "M3i-W30@1" });
});

test("서버 확률표 버전이 다르면 뽑기 버튼이 막히고 안내가 보인다", async ({ page }) => {
  const s = setup([], "odds1-deadbeef");
  await page.route(SERVER + "/**", s.handle);
  await page.addInitScript((v) => localStorage.setItem("yachtlab.session.v1", v), SESSION);
  await page.goto(`?online-server=${encodeURIComponent(SERVER)}#draw`);
  await expect(page.getByRole("alert")).toContainText("뽑기 확률표가 이 화면과 달라요");
  await expect(page.getByRole("button", { name: "250코인으로 1회 뽑기" })).toBeDisabled();
});

test("C5 장기 활동 칭호 3종은 상점에서 '업적 보상'으로만 보이고 구매 버튼·신상품·뽑기 확률표에 없다", async ({ page }) => {
  const s = setup();
  await page.route(SERVER + "/**", s.handle);
  await page.addInitScript((v) => localStorage.setItem("yachtlab.session.v1", v), SESSION);
  await page.goto(`?online-server=${encodeURIComponent(SERVER)}#shop`);
  await expect(page.getByRole("list", { name: "신상품 상품" }).locator('[data-item^="title.streak"]')).toHaveCount(0);
  await page.getByRole("tab", { name: /^칭호/ }).click();
  for (const id of ["title.streak30", "title.streak100", "title.streak365"]) {
    const card = page.locator(`[data-item="${id}"]`);
    await expect(card).toContainText("업적 보상");
    await expect(card).not.toContainText("판매 준비 중");
  }
  await page.locator('[data-item="title.streak30"] .item-card-button').click();
  const d = page.getByRole("dialog", { name: /상세$/ });
  await expect(d).toContainText("업적으로만 얻을 수 있어요");
  await expect(d.getByRole("button", { name: /구매/ })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.goto(`?online-server=${encodeURIComponent(SERVER)}#draw`);
  await page.getByText("족보와 상품별 확률", { exact: true }).click();
  await expect(page.locator(".draw-odds")).not.toContainText("한 달 항해사");
  expect(s.bodies.filter((b) => b.path !== "/api/me/economy")).toEqual([]);
});

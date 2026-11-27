import { expect, test, type Page, type Route } from "@playwright/test";
import { DEFAULT_LOADOUT, publicLook } from "../../src/economy/live/catalog";

/**
 * A4 profile on every width (signed-in view with a mocked server): equipped items with level pips,
 * ownership summary, 3 pin slots (device-local), readable match rows, no sideways scroll from 320 px to
 * tablet. Screenshots with A4_SHOTS=<tag> go to docs/ui/a4-mobile/.
 */
const SERVER = "http://127.0.0.1:8799";
const SESSION = "s1.u_" + "a".repeat(22) + "." + "b".repeat(43);
const loadout = { ...DEFAULT_LOADOUT, dice: "dice.sunset", board: "board.felt", nameFx: "nameFx.sunset", title: "title.collector", profile: "profile.planet", bubble: "bubble.neon", levels: { "dice.sunset": 2, "profile.planet": 3, "nameFx.sunset": 1, "bubble.neon": 2 } } as typeof DEFAULT_LOADOUT;
const inventory = [["dice.sunset", 2], ["board.felt", 1], ["nameFx.sunset", 1], ["title.collector", 1], ["profile.planet", 3], ["bubble.neon", 2], ["dice.mint", 1], ["dice.ink", 1], ["emote.fire", 3], ["emote.rocket", 1]].map(([id, level], i) => ({ id, level, via: "coins", at: i }));
const owned = new Map(inventory.map((i) => [i.id as string, i.level as number]));
const rec = (i: number, outcome: "win" | "loss" | "draw", mine: number, theirs: number, name: string) => ({
  recordId: "r" + i, mode: "online", rules: "nintendo-12", source: "server", verification: "server-verified", startedAt: 1_700_000_000_000 + i * 1e6, endedAt: 1_700_000_900_000 + i * 1e6,
  name: "나", score: mine, card: {}, outcome, endReason: "completed", opponent: { name, kind: "member", score: theirs, userId: "u_" + String(i).repeat(22).slice(0, 22) }, kind: "random",
});
const records = [rec(1, "win", 231, 198, "긴닉네임을가진상대플레이어"), rec(2, "loss", 176, 204, "철수"), rec(3, "draw", 190, 190, "영희"), rec(4, "win", 245, 201, "민수"), rec(5, "win", 212, 180, "지민")];
async function open(page: Page) {
  const snap = { config: "M3i-W30@1", wallet: { coins: 1200, gems: 40 }, inventory, slots: { emote: 4, chat: 6 }, loadout, look: publicLook(loadout, owned), state: { day: 1, week: 1, rerolls: 0, rewarded: 0, streak: 2, dailyAll: false, weeklyAll: false, daily: [], weekly: [], counters: { match: 12, win: 7 }, achievements: ["a.match.10", "a.yacht.1", "a.win.10", "a.yacht.10", "a.large.10"] }, ledger: [] };
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type,authorization" };
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", headers: cors, body: JSON.stringify(body) });
  await page.route(SERVER + "/**", (route) => {
    const u = new URL(route.request().url());
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    if (u.pathname === "/api/me/economy") return json(route, { snapshot: snap });
    if (u.pathname === "/api/me") return json(route, { profile: { userId: "u_" + "a".repeat(22), provider: "google", nickname: "요트왕", createdAt: 1_690_000_000_000 } });
    if (u.pathname === "/api/me/records") return json(route, { records });
    return json(route, { error: { code: "NOT_FOUND", message: "-" } }, 404);
  });
  await page.addInitScript((s) => { localStorage.setItem("yachtlab.session.v1", s); localStorage.setItem("yachtlab.settings.v1", JSON.stringify({ muted: true })); if (!sessionStorage.getItem("a4init")) { sessionStorage.setItem("a4init", "1"); localStorage.removeItem("yachtlab.profile-pins.v1"); } }, SESSION);
  await page.goto(`?online-server=${encodeURIComponent(SERVER)}#profile`);
  await expect(page.getByRole("region", { name: "장착 중인 꾸미기" })).toBeVisible({ timeout: 15_000 });
}
const SIZES = [{ n: "320x568", w: 320, h: 568 }, { n: "360x800", w: 360, h: 800 }, { n: "390x844", w: 390, h: 844 }, { n: "768x1024", w: 768, h: 1024 }, { n: "1280x800", w: 1280, h: 800 }];

for (const s of SIZES) {
  test(`프로필 ${s.n}: 장착 단계·보유 요약·대표 업적 슬롯·전적이 가로 스크롤 없이 읽힌다`, async ({ page }, info) => {
    test.skip(info.project.name === "mobile", "sizes are explicit");
    await page.setViewportSize({ width: s.w, height: s.h });
    await open(page);
    const equipped = page.getByRole("region", { name: "장착 중인 꾸미기" });
    await expect(equipped.getByRole("img", { name: /강화 2단계 \/ 최대 3단계/ }).first()).toBeVisible(); // 노을 주사위 Lv.2
    await expect(equipped.getByRole("img", { name: /강화 3단계 \/ 최대 3단계/ })).toBeVisible(); // 행성 프레임 Lv.3
    const own = page.getByRole("region", { name: "수집 현황" });
    await expect(own.getByLabel("보유 요약")).toContainText("10개 보유");
    await expect(own.getByLabel("보유 요약")).toContainText("개 강화");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    // match rows: score line and opponent stay inside their card
    const clipped = await page.locator(".profile-matches li").evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().right > innerWidth + 1).length);
    expect(clipped).toBe(0);
    if (process.env.A4_SHOTS) await page.screenshot({ path: `docs/ui/a4-mobile/${process.env.A4_SHOTS}-profile-${s.n}.png`, fullPage: true });
  });
}

test("대표 업적은 슬롯 3개에 고르고 해제할 수 있으며 새로고침 뒤에도 유지된다(이 기기 저장)", async ({ page }, info) => {
  test.skip(info.project.name === "mobile", "desktop run");
  await open(page);
  const card = page.getByRole("region", { name: "업적" });
  const slots = card.getByRole("list", { name: "대표 업적 슬롯" });
  await expect(slots.locator("li.empty")).toHaveCount(3);
  const badges = card.locator(".profile-badge");
  for (let i = 0; i < 4; i++) await badges.nth(i).click();
  await expect(slots.locator("li.filled")).toHaveCount(3); // the fourth replaces the oldest: never more than 3
  await expect(page.locator(".profile-pins li")).toHaveCount(3);
  await slots.locator("li.filled button").first().click();
  await expect(slots.locator("li.filled")).toHaveCount(2);
  await page.reload();
  await expect(page.getByRole("region", { name: "업적" }).getByRole("list", { name: "대표 업적 슬롯" }).locator("li.filled")).toHaveCount(2);
});

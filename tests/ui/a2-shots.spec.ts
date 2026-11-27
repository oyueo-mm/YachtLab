import { test, type Page, type Route } from "@playwright/test";
import { DEFAULT_LOADOUT, publicLook } from "../../src/economy/live/catalog";
import { withMotion } from "./helpers";

/**
 * Representative screenshots for docs/ui/a2-2026-11 (shop previews and the chat picker). Only runs with
 * A2_SHOTS=1 so CI does not rewrite images:  A2_SHOTS=1 npx playwright test tests/ui/a2-shots.spec.ts
 */
const OUT = "docs/ui/a2-2026-11/after/";
const SERVER = "http://127.0.0.1:8799";
const SESSION = "s1.u_" + "a".repeat(22) + "." + "b".repeat(43);
async function shop(page: Page) {
  const snap = { config: "M3i-W30@1", wallet: { coins: 99999, gems: 999 }, inventory: [], slots: { emote: 4, chat: 6 }, loadout: { ...DEFAULT_LOADOUT }, look: publicLook(DEFAULT_LOADOUT, new Map()),
    state: { day: 1, week: 1, rerolls: 0, rewarded: 0, streak: 0, dailyAll: false, weeklyAll: false, daily: [], weekly: [], counters: {}, achievements: [] }, ledger: [] };
  await page.route(SERVER + "/**", (route: Route) => {
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type,authorization" };
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    if (new URL(route.request().url()).pathname === "/api/me/economy") return route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify({ snapshot: snap }) });
    return route.fulfill({ status: 404, contentType: "application/json", headers: cors, body: JSON.stringify({ error: { code: "NOT_FOUND", message: "-" } }) });
  });
  await page.addInitScript((s) => { localStorage.setItem("yachtlab.session.v1", s); localStorage.setItem("yachtlab.settings.v1", JSON.stringify({ muted: true })); }, SESSION);
  await page.goto(`?online-server=${encodeURIComponent(SERVER)}#shop`);
}
test.skip(!process.env.A2_SHOTS, "screenshot capture only");

test("상점 상세 미리보기 스크린샷", async ({ page }, info) => {
  await withMotion(page);
  await shop(page);
  const tag = info.project.name;
  const detail = async (tab: RegExp, name: string, file: string, act?: () => Promise<void>) => {
    await page.getByRole("tab", { name: tab }).click();
    await page.getByRole("button", { name: `${name} 자세히` }).click();
    const d = page.getByRole("dialog", { name: `${name} 상세` });
    if (act) await act();
    await page.waitForTimeout(900);
    await d.screenshot({ path: `${OUT}${tag}-shop-${file}.png` });
    await page.keyboard.press("Escape");
  };
  await detail(/^말풍선/, "홀로그램", "bubble-holo", async () => { await page.getByRole("dialog").getByRole("tab", { name: /^Lv\.3/ }).click(); });
  await detail(/^닉네임 효과/, "네온", "name-neon", async () => { await page.getByRole("dialog").getByRole("tab", { name: /^Lv\.3/ }).click(); });
  await detail(/^프로필/, "크리스탈", "frame-crystal", async () => { await page.getByRole("dialog").getByRole("tab", { name: /^Lv\.3/ }).click(); });
  await detail(/^칭호/, "전설의 굴림", "title");
  await detail(/^특수 연출/, "불꽃놀이", "fx-yacht", async () => {
    const d = page.getByRole("dialog");
    await d.getByRole("tab", { name: /^Lv\.3/ }).click();
    await d.getByRole("button", { name: "요트", exact: true }).click();
  });
  await detail(/^특수 연출/, "불꽃놀이", "fx-large", async () => {
    const d = page.getByRole("dialog");
    await d.getByRole("tab", { name: /^Lv\.3/ }).click();
    await d.getByRole("button", { name: "라지 스트레이트", exact: true }).click();
  });
});

test("채팅 선택창 스크린샷", async ({ page }, info) => {
  await withMotion(page);
  await page.addInitScript(() => localStorage.setItem("yachtlab.settings.v1", JSON.stringify({ muted: true })));
  await page.goto("?lab=1#cosmetics-lab");
  const stage = page.getByTestId("dock-stage");
  await stage.scrollIntoViewIfNeeded();
  await stage.getByRole("button", { name: "채팅·이모티콘" }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}${info.project.name}-chat-picker.png` });
  await stage.getByRole("button", { name: "대박!", exact: true }).click();
  await page.waitForTimeout(250);
  await stage.screenshot({ path: `${OUT}${info.project.name}-chat-sent.png` });
});

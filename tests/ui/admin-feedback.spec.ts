import { expect, test, type Page } from "@playwright/test";

/**
 * ADMIN-1 / FEEDBACK-1 pages against a MOCKED online server (page.route on a loopback address): no
 * Worker, no account, no production data. Checks the admin gate, read-only screens, "미집계" display,
 * mobile menu, and that a suggestion containing HTML is rendered as text (SEC-1 stored XSS).
 */
const SERVER = "http://127.0.0.1:8799";
const SESSION = "s1.u_AAAAAAAAAAAAAAAAAAAAAA." + "x".repeat(43);
const ADMIN = "a1." + "y".repeat(43);
const XSS = '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script>';

async function mock(page: Page, opts: { admin: boolean }) {
  await page.addInitScript((s) => localStorage.setItem("yachtlab.session.v1", s), SESSION);
  await page.route(SERVER + "/**", async (route) => {
    const url = new URL(route.request().url());
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type, authorization" } });
    const p = url.pathname;
    if (p === "/api/auth/config") return json(200, { google: true });
    if (p === "/api/features") return json(200, { signIn: true, economy: true });
    if (p === "/api/admin/session") return opts.admin ? json(200, { token: ADMIN, role: "owner", permissions: ["stats.read", "users.read", "audit.read", "reports.read", "reports.write", "notices.write", "rewards.write", "codes.write", "sanctions.write", "suggestions.write", "approve"], writes: false, selfApprove: false, freshMs: 600000 }) : json(404, { error: { code: "NOT_FOUND", message: "없는 주소입니다." } });
    if (p === "/api/admin/overview") return json(200, { activity: { timezone: "UTC", since: "2026-11-28", indexedMembers: 3, days: [{ day: "2026-11-27", dau: 0, wau: 0, mau: 0, signups: 0, deleted: 0, returns: {} }, { day: "2026-11-28", dau: 2, wau: 2, mau: 2, signups: 1, deleted: 0, returns: { new: 1, "1d": 1 } }] }, live: { waiting: 0, playing: { random: 1, friend: 0, ai: 0 } }, usage: { roomsToday: 4, dailyRoomLimit: 300 }, flags: { adminWrites: false, feedback: true }, concurrentVisitors: null });
    if (p === "/api/admin/members") return json(200, { total: 1, page: 0, pageSize: 50, members: [{ userId: "u_BBBBBBBBBBBBBBBBBBBBBB", nickname: "회원1", createdAt: Date.UTC(2026, 10, 1), lastActive: "2026-11-28", status: "ok", statusUntil: null }] });
    if (p === "/api/suggestions") return json(200, { total: 1, page: 0, pageSize: 20, items: [{ id: "sg_aaaaaaaaaaaaaaaa", category: "uiux", title: XSS, body: XSS, status: "received", votes: 3, author: "테스터", private: false, createdAt: Date.now(), updatedAt: Date.now(), answer: null, answeredAt: null }] });
    if (p === "/api/suggestions/sg_aaaaaaaaaaaaaaaa") return json(200, { suggestion: { id: "sg_aaaaaaaaaaaaaaaa", category: "uiux", title: XSS, body: XSS + "\nhttps://evil.example", status: "received", votes: 3, author: "테스터", private: false, createdAt: Date.now(), updatedAt: Date.now(), answer: null, answeredAt: null } });
    if (p === "/api/suggestions/contributors") return json(200, { contributors: [] });
    if (p === "/api/admin/rewards") return json(200, { campaigns: [] });
    if (p === "/api/me") return json(200, { profile: { userId: "u_AAAAAAAAAAAAAAAAAAAAAA", provider: "google", nickname: "운영자", createdAt: Date.UTC(2026, 10, 1) } });
    return json(404, { error: { code: "NOT_FOUND", message: "없는 주소입니다." } });
  });
}

test("admin console: non-admin is refused, admin sees read-only dashboard with 미집계 values", async ({ page }) => {
  await mock(page, { admin: false });
  await page.goto(`./?online-server=${SERVER}#admin`);
  await page.getByRole("button", { name: "관리자 세션 시작" }).click();
  await expect(page.getByRole("alert")).toContainText("관리자 권한");
});

test("admin console: dashboard, members and writes-off banner", async ({ page }, info) => {
  await mock(page, { admin: true });
  await page.goto(`./?online-server=${SERVER}#admin`);
  await page.getByRole("button", { name: "관리자 세션 시작" }).click();
  await expect(page.getByRole("heading", { name: "서비스 대시보드" })).toBeVisible();
  await expect(page.locator(".adm-tile", { hasText: "동시 접속자" })).toContainText("미집계");
  await expect(page.locator(".adm-tile", { hasText: "DAU(오늘)" })).toContainText("2");
  await expect(page.getByRole("img", { name: "일간 활성 회원(DAU)" })).toBeVisible();
  if (info.project.name === "mobile") await page.locator(".adm-mobile-menu select").selectOption("users");
  else await page.getByRole("button", { name: "사용자", exact: true }).click();
  await expect(page.getByRole("cell", { name: "회원1" })).toBeVisible();
  if (info.project.name === "mobile") await page.locator(".adm-mobile-menu select").selectOption("rewards");
  else await page.getByRole("button", { name: "보상 관리" }).click();
  await expect(page.getByText("관리자 쓰기 기능(ADMIN_WRITES)이 꺼져 있어요")).toBeVisible();
  await expect(page.getByRole("button", { name: "지급 초안 만들기" })).toBeDisabled();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("suggestion board renders HTML in posts as plain text and links as text", async ({ page }) => {
  await mock(page, { admin: false });
  await page.goto(`./?online-server=${SERVER}#suggestions`);
  await expect(page.getByRole("heading", { name: "서비스 제안" })).toBeVisible();
  await page.locator(".eng-item").first().click();
  await expect(page.locator(".eng-detail h1")).toHaveText(XSS);
  await expect(page.locator(".eng-detail img, .eng-detail script, .eng-detail a")).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
});

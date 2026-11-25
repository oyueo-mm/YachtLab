import { returningVisitorState } from "./visitor";
import { expect, test } from "@playwright/test";
import { startOnlineServer } from "../../server/online/server";
import { nick } from "./helpers";

test("경기 후 홈에서 서버 보상 진행률을 확인하고 닫을 때까지 지급 API를 호출하지 않는다", async ({ browser, baseURL, page }) => {
  const origin = new URL(baseURL!).origin;
  const server = await startOnlineServer({ port: 0, dataDir: null, allowedOrigins: [origin], turnTimeoutMs: null });
  const guestContext = await browser.newContext({ storageState: returningVisitorState(), baseURL, reducedMotion: "reduce" });
  try {
    const guest = await guestContext.newPage();
    const entry = `?online-server=${encodeURIComponent(server.url)}`;
    await page.goto(entry + "#online");
    const create = page.getByRole("button", { name: "방 만들기", exact: true });
    await expect(create).toBeEnabled();
    await nick(page, "방장");
    await create.click();
    const lobby = page.getByRole("region", { name: "대기실", exact: true });
    const inviteCode = lobby.getByLabel("초대 코드", { exact: true });
    await expect(inviteCode).toHaveText(/^[A-Z2-9]{6}$/);
    const code = await inviteCode.innerText();
    await guest.goto(entry + `&room=${code}#online`);
    await expect(guest.getByText(`초대 코드 ${code}`, { exact: true })).toBeVisible();
    await nick(guest, "손님");
    await guest.getByRole("button", { name: "입장하기", exact: true }).click();
    await expect(guest.getByRole("heading", { name: "대기실" })).toBeVisible();
    await expect(lobby.getByRole("list", { name: "참가자" })).toContainText("손님");
    await lobby.getByRole("button", { name: "게임 시작", exact: true }).click();
    await expect(page.locator(".roll-button")).toBeVisible();
    await expect(guest.locator(".roll-button")).toBeVisible();

    // The Node room has no accounts. Inject only a valid session shape and mock the read-only receipt.
    await page.evaluate(() => localStorage.setItem("yachtlab.session.v1", `s1.u_${"a".repeat(22)}.${"b".repeat(43)}`));
    const rewardMethods: string[] = [];
    await page.route(new RegExp(`${server.url}/api/me/records/[^/]+/reward$`), async (route) => {
      const request = route.request();
      if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": origin, "access-control-allow-headers": "authorization" } });
      rewardMethods.push(request.method());
      await route.fulfill({
        headers: { "access-control-allow-origin": origin },
        json: { receipt: {
          before: { coins: 200, gems: 20 },
          after: { coins: 237, gems: 21 },
          quests: [{ id: "d.play3", previous: 2, progress: 3, done: true }],
          grants: [
            { kind: "achievement", label: "업적 · 첫 승리", coins: 6, gems: 0 },
            { kind: "quest-bonus", label: "일일 퀘스트 모두 완료", coins: 15, gems: 1 },
          ],
        } },
      });
    });
    await guest.getByRole("button", { name: "기권", exact: true }).click();
    await guest.getByRole("dialog").getByRole("button", { name: "기권", exact: true }).click();
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.evaluate(() => {
      const widths = new Set<string>();
      const observer = new MutationObserver(() => {
        const meter = document.querySelector<HTMLElement>(".match-reward-progress i");
        if (!meter) return;
        widths.add(meter.style.width);
        if (meter.style.width === "100%") {
          document.body.dataset.rewardWidths = String(widths.size);
          observer.disconnect();
        }
      });
      observer.observe(document.body, { attributes: true, childList: true, subtree: true });
    });
    await page.getByRole("button", { name: "로비로" }).click();
    const earned = page.getByRole("region", { name: "이번 경기 보상" });
    await expect(earned).toContainText("+37코인");
    await expect(earned).toContainText("+1보석");
    await expect(earned.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "3");
    await expect(earned).toContainText("2 → 3/3");
    await expect(earned).toContainText("일일 퀘스트 모두 완료");
    await expect(earned).toContainText("업적 · 첫 승리");
    await expect(earned.locator(".match-reward-wallet [aria-hidden=true]").last()).toHaveText("237코인 · 21보석");
    await expect.poll(async () => Number(await page.locator("body").getAttribute("data-reward-widths"))).toBeGreaterThan(2);
    await earned.getByRole("button", { name: "보상 알림 닫기" }).click();
    await expect(earned).toHaveCount(0);
    expect(rewardMethods.length).toBeGreaterThan(0);
    expect(rewardMethods.every((method) => method === "GET")).toBe(true);
  } finally {
    await guestContext.close();
    await server.close();
  }
});

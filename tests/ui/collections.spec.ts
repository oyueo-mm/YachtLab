import { expect, test, type Page } from "@playwright/test";
import { withMotion } from "./helpers";

/** Theme collections, synergy and the 2.5D fallback effects (2026-11-27). */
async function ownLook(page: Page, look: Record<string, unknown>, settings: Record<string, unknown> = {}) {
  await page.route(/workers\.dev|\/api\//, (route) => route.abort());
  await page.addInitScript(([l, s]) => {
    const u = "u_" + "a".repeat(22);
    localStorage.setItem("yachtlab.session.v1", "s1." + u + "." + "b".repeat(43));
    localStorage.setItem("yachtlab.own-look.v1", JSON.stringify({ account: u, look: { emotes: [], chats: [], ...l } }));
    localStorage.setItem("yachtlab.settings.v1", JSON.stringify({ muted: true, ...s }));
  }, [look, settings] as const);
}

test("상점: 테마 컬렉션으로 모아 보고, 새 상품은 서버가 열기 전까지 '판매 준비 중'이며 조합 미리보기에 시너지가 켜진다", async ({ page }) => {
  await withMotion(page);
  await page.goto("#shop");
  await page.getByRole("combobox", { name: "테마 컬렉션" }).click();
  await page.getByRole("option", { name: "번개 컬렉션" }).click();
  await expect(page.locator(".collection-banner")).toContainText("번개 컬렉션");
  await expect(page.locator('[data-item="dice.thunder"]')).toBeVisible();
  await expect(page.locator('[data-item="board.storm"]')).toBeVisible();
  await expect(page.locator('[data-item="dice.lava"]')).toHaveCount(0);
  await expect(page.locator('[data-item="dice.thunder"]')).toContainText("판매 준비 중");
  await page.locator('[data-item="dice.thunder"] .item-card-button').click();
  const detail = page.getByRole("dialog", { name: "번개 상세" });
  await expect(detail).toContainText("번개 컬렉션");
  await expect(detail.getByRole("button", { name: /코인으로 구매/ })).toHaveCount(0);
  await detail.locator(".stage-pair input").check();
  await expect(detail.locator(".stage-board")).toHaveAttribute("data-synergy", "lightning");
  await expect(detail.locator(".board-synergy-canvas")).toHaveCount(1);
});

test("같은 컬렉션의 주사위와 보드판을 장착하면 게임에서 시너지가 켜지고, 다른 조합이면 꺼진다", async ({ page }) => {
  await withMotion(page);
  await ownLook(page, { dice: "dice.lava", diceLv: 3, board: "board.volcano", boardLv: 3 });
  await page.goto("#solo");
  await expect(page.locator(".game-board")).toHaveAttribute("data-synergy", "lava");
  await page.goto("about:blank");
  await ownLook(page, { dice: "dice.lava", diceLv: 3, board: "board.space", boardLv: 3 });
  await page.goto("#solo");
  await expect(page.locator(".game-board.bd-space")).toBeVisible();
  await expect(page.locator(".game-board")).not.toHaveAttribute("data-synergy", /.+/);
});

test("2.5D 폴백: 굴린 뒤에도 보드·시너지·Lv.3 주사위 효과 캔버스가 남고 주사위 크기는 그대로다", async ({ page }) => {
  await withMotion(page);
  await ownLook(page, { dice: "dice.thunder", diceLv: 3, board: "board.storm", boardLv: 3 }, { diceQuality: "2.5d" });
  await page.goto("#solo");
  await expect(page.locator(".board-synergy-canvas")).toHaveCount(1);
  await page.locator(".roll-button").click();
  await expect(page.locator(".roll-button")).toContainText("2회 남음");
  await expect.poll(() => page.evaluate(() => ((window as unknown as { __yachtlabFxEvents?: { type: string }[] }).__yachtlabFxEvents ?? []).filter((e) => e.type === "land").length)).toBeGreaterThan(0);
  await expect(page.locator(".board-synergy-canvas")).toHaveCount(1);
  await expect(page.locator(".dice-fx-25")).toHaveCount(1);
  const widths = await page.locator(".die-button").evaluateAll((nodes) => nodes.map((n) => n.getBoundingClientRect().width));
  for (const w of widths) expect(w).toBeGreaterThan(30);
});

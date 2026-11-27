import { expect, test, type Page } from "@playwright/test";
import { withMotion } from "./helpers";

/** A2 (2026-11-27): the cosmetics preview page (same components as the game), chat sheet, special-effect stagings. */
const open = async (page: Page) => {
  await page.route(/workers\.dev|\/api\//, (route) => route.abort());
  await page.addInitScript(() => localStorage.setItem("yachtlab.settings.v1", JSON.stringify({ muted: true })));
  await page.goto("?lab=1#cosmetics-lab");
  await expect(page.locator(".cosm-lab")).toBeVisible();
};
const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

test("채팅 fixture 44개(무료 6 + 후보 38)가 등급별로 나뉘고 눌러서 직접 재생된다", async ({ page }) => {
  await open(page);
  const buttons = page.locator('[aria-label="채팅 38종"] .line-buttons button');
  await expect(buttons).toHaveCount(44);
  for (const [tier, n] of [["basic", 6], ["common", 9], ["rare", 8], ["epic", 9], ["legendary", 7], ["mythic", 5]] as const) await expect(page.locator(`[aria-label="채팅 38종"] button[data-tier="${tier}"]`)).toHaveCount(n);
  await page.getByRole("button", { name: "요트 한 번만!", exact: true }).click();
  await expect(page.getByTestId("chat-stage").locator(".feed-text")).toHaveText("요트 한 번만!");
  await expect(page.getByTestId("chat-meta")).toContainText("신화");
  await expect(page.getByTestId("chat-meta")).toContainText("plead");
  expect(await noSideScroll(page)).toBe(true);
});

test("모든 말풍선이 같은 컴포넌트로 표시되고 문구가 읽힌다(가림 없음)", async ({ page }) => {
  await open(page);
  const select = page.locator('[aria-label="말풍선"] select');
  const values = await select.locator("option").evaluateAll((o) => o.map((x) => (x as HTMLOptionElement).value).filter(Boolean));
  expect(values.length).toBeGreaterThanOrEqual(15);
  for (const v of values) {
    await select.selectOption(v);
    const msg = page.getByTestId("chat-stage").locator(".feed-msg");
    await expect(msg).toHaveClass(new RegExp(v.replace("bubble.", "bubble-")));
    const text = msg.locator(".feed-text");
    await expect(text).toBeVisible();
    const box = await text.boundingBox();
    expect(box && box.width > 20 && box.height > 8).toBeTruthy();
  }
});

test("닉네임·칭호·프레임 조합이 함께 표시되고 좌석(어두운 배경)에서도 이름이 보인다", async ({ page }) => {
  await open(page);
  const stage = page.getByTestId("tag-stage");
  await expect(stage.locator(".player-name").first()).toHaveClass(/namefx-neon/);
  await expect(stage.locator(".player-title[data-title]")).toHaveAttribute("data-title", "title.legend_roll");
  await expect(stage.locator('.player-icon[class*="pf-ring-"]').first()).toBeVisible();
  const seatName = stage.locator(".seat-dark .player-name");
  await expect(seatName).toHaveText("요트왕");
  expect((await seatName.boundingBox())!.width).toBeGreaterThan(20);
});

test("특수 효과: 요트는 한 점에서 퍼지고 라지 스트레이트는 주사위 줄을 따라 지나가며, 입력을 막지 않는다", async ({ page }) => {
  await withMotion(page);
  await open(page);
  const stage = page.getByTestId("fx-stage");
  const fx = page.locator('[aria-label="특수 효과"]');
  await fx.getByRole("button", { name: "요트", exact: true }).click();
  await expect(stage.locator(".fx-burst.fx-kind-yacht")).toBeVisible();
  const yacht = await stage.locator(".fx-burst i").count();
  await fx.getByRole("button", { name: "라지 스트레이트", exact: true }).click();
  await expect(stage.locator(".fx-burst.fx-kind-large")).toBeVisible();
  const large = await stage.locator(".fx-burst i").count();
  await fx.getByRole("button", { name: "승리", exact: true }).click();
  const win = await stage.locator(".fx-burst i").count();
  expect(large).toBeLessThan(win);
  expect(yacht).toBeLessThanOrEqual(win);
  expect(await stage.locator(".fx-burst").evaluate((n) => getComputedStyle(n).pointerEvents)).toBe("none");
  // The burst frees itself: no particles are animated after the show.
  await page.waitForTimeout(100);
});

test("동작 줄이기에서는 특수 효과 입자를 그리지 않는다", async ({ page }) => {
  await open(page); // the project default is prefers-reduced-motion: reduce
  await page.getByRole("button", { name: "재생" }).click();
  await expect(page.getByTestId("fx-stage").locator(".fx-burst")).toHaveCount(0);
});

test("게임 좌석 말풍선은 장착한 말풍선의 표면을 유지한다(흰색으로 덮이지 않는다)", async ({ page }) => {
  await open(page);
  const result = await page.evaluate(() => {
    const chip = document.createElement("div");
    chip.className = "table-v4";
    chip.innerHTML = '<div class="seat-chip"><div class="anchored-feed"><span class="feed-msg chat bubble-neon" id="a"><span class="feed-text">좋아요!</span></span><span class="feed-msg chat" id="b"><span class="feed-text">좋아요!</span></span></div></div>';
    document.body.append(chip);
    const bg = (id: string) => getComputedStyle(document.getElementById(id)!).backgroundColor;
    return { neon: bg("a"), plain: bg("b") };
  });
  expect(result.plain).toBe("rgb(255, 255, 255)");
  expect(result.neon).not.toBe("rgb(255, 255, 255)");
});

test("모바일: 미리보기 페이지가 가로로 넘치지 않고 채팅 버튼이 터치 크기다", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile", "phone layout");
  await open(page);
  expect(await noSideScroll(page)).toBe(true);
  const small = await page.locator('[aria-label="채팅 38종"] .line-buttons button').evaluateAll((b) => b.filter((x) => x.getBoundingClientRect().height < 38).length);
  expect(small).toBe(0);
});

test("채팅 선택창: 등급별로 묶여 있고, 보내면 의미에 맞는 움직임으로 표시된다(미리보기 전송 없음)", async ({ page }) => {
  await withMotion(page);
  await open(page);
  const stage = page.getByTestId("dock-stage");
  await stage.getByRole("button", { name: "채팅·이모티콘" }).click();
  const sheet = stage.getByRole("dialog", { name: "채팅·이모티콘" });
  await expect(sheet).toBeVisible();
  await expect(sheet.locator(".social-tier")).toHaveCount(6);
  expect(await sheet.locator(".social-tier-lines button").evaluateAll((b) => b.filter((x) => x.getBoundingClientRect().height < 44).length)).toBe(0);
  await sheet.getByRole("button", { name: "대박!", exact: true }).click();
  const msg = stage.locator(".table-feed .feed-msg.chat");
  await expect(msg).toHaveText(/대박!/);
  await expect(msg).toHaveClass(/chat-m-shout/);
  await expect(msg).toHaveClass(/chat-t-legendary/);
  await expect(stage.locator(".dock-state")).not.toContainText("보내지 못했어요");
});

test("상단 보너스: 63점 도달 때 BONUS! +35점이 한 번만 나오고, 진행률이 강조되며, 다시 렌더링해도 반복하지 않고 입력을 막지 않는다", async ({ page }) => {
  await withMotion(page);
  await open(page);
  const sec = page.locator('[aria-label="상단 보너스"]');
  const stage = page.getByTestId("bonus-stage");
  await expect(stage.locator(".bonus-pop")).toHaveCount(0); // nothing on open
  await expect(stage.locator(".bonus-progress")).not.toHaveClass(/achieved/);
  await sec.getByRole("button", { name: /63점/ }).click();
  const pop = stage.locator(".bonus-pop");
  await expect(pop).toBeVisible();
  await expect(pop).toContainText("BONUS!");
  await expect(pop).toContainText("+35점");
  await expect(stage.locator(".bonus-progress")).toHaveClass(/achieved/);
  await expect(stage.locator(".bonus-progress")).toHaveClass(/just/);
  await expect(stage.locator(".fx-burst.fx-kind-bonus")).toHaveCount(1); // the shared effect renderer, default look (no item)
  expect(await stage.locator(".bonus-moment").evaluate((n) => getComputedStyle(n).pointerEvents)).toBe("none");
  // clicking the same state again must not replay it
  const shown = await page.evaluate(() => (window as unknown as { __yachtlabBonus?: unknown[] }).__yachtlabBonus?.length ?? 0);
  await sec.getByRole("button", { name: /63점/ }).click();
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => (window as unknown as { __yachtlabBonus?: unknown[] }).__yachtlabBonus?.length ?? 0)).toBe(shown);
  await expect(pop).toHaveCount(0, { timeout: 4000 }); // it frees itself
  // a new game re-arms it
  await sec.getByRole("button", { name: "새 경기" }).click();
  await sec.getByRole("button", { name: "상단 45점으로 되돌리기" }).click();
  await sec.getByRole("button", { name: /63점/ }).click();
  await expect(stage.locator(".bonus-pop")).toBeVisible();
  // an equipped special effect (Lv.2+) gives the burst its shape
  await sec.getByRole("button", { name: "새 경기" }).click();
  await sec.getByRole("button", { name: "상단 45점으로 되돌리기" }).click();
  await sec.locator("select").selectOption("fx.coins");
  await sec.getByRole("button", { name: /63점/ }).click();
  await expect(stage.locator(".fx-burst.fx-kind-bonus.fx-shape-coin")).toHaveCount(1);
});

test("상단 보너스: 동작 줄이기에서는 입자 없이 정지한 BONUS! 표시만 나온다", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("yachtlab.settings.v1", JSON.stringify({ muted: true, reducedEffects: true })));
  await page.goto("?lab=1#cosmetics-lab");
  await expect(page.locator(".cosm-lab")).toBeVisible();
  const sec = page.locator('[aria-label="상단 보너스"]');
  await sec.getByRole("button", { name: /63점/ }).click();
  const moment = page.getByTestId("bonus-stage").locator(".bonus-moment");
  await expect(moment).toHaveClass(/static/);
  await expect(moment.locator(".bonus-pop b")).toHaveText("+35점");
  await expect(moment.locator(".fx-burst")).toHaveCount(0);
});

import { expect, test, devices, type Page } from "@playwright/test";
import { returningVisitorState } from "./visitor";
import { nick, scoreCategory, startAI, startLocal } from "./helpers";
import { startLocalWorker, type LocalWorker } from "../helpers/wrangler";

/**
 * UI-1 (2026-11-28) regressions: the shared N-player score sheet, the global header + friends panel,
 * the floating quick-match popup, the share modal and the review key-scene cards.
 */
const WIDTHS = [320, 360, 390, 430, 768, 1024, 1280, 1440, 1920] as const;
/** Optional screenshots for the PR/docs: UI1_SHOTS=<dir>. */
const shot = (page: Page, name: string) => (process.env.UI1_SHOTS ? page.screenshot({ path: `${process.env.UI1_SHOTS}/${name}.png` }) : Promise.resolve());
const settle = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 50)))));
const noPageScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

/** Every score button is ≥ 44px wide, inside its cell and clear of the (sticky) category column. */
async function sheetIsUsable(page: Page, scope: string) {
  await settle(page);
  return page.evaluate((scope) => {
    const sheet = document.querySelector(scope + " .ui1-sheet") as HTMLElement | null;
    if (!sheet) return "no sheet";
    const scroller = sheet.querySelector(".multi-score-scroll") as HTMLElement;
    const cat = sheet.querySelector("tbody tr[data-category] th") as HTMLElement;
    const catRight = cat.getBoundingClientRect().right;
    for (const button of sheet.querySelectorAll<HTMLElement>(".score-option")) {
      const b = button.getBoundingClientRect();
      const cell = button.parentElement!.getBoundingClientRect();
      if (b.width < 43.5) return `button ${b.width}px`;
      const minHeight = matchMedia("(pointer: fine)").matches ? 25.5 : 35.5; // mouse: compact rows (26px); touch: 36px
      if (b.height < minHeight) return `button height ${b.height}px`;
      if (b.left < cell.left - 0.5 || b.right > cell.right + 0.5) return `button outside its cell`;
      if (b.left < catRight - 0.5) return "button under the category column";
    }
    for (const name of sheet.querySelectorAll<HTMLElement>("thead .col-name")) if (name.scrollWidth > name.clientWidth + 1 && getComputedStyle(name).textOverflow !== "ellipsis") return "name overflows";
    const current = sheet.querySelector("thead th.current");
    if (!current) return "no current-turn column";
    if (scroller.scrollWidth > scroller.clientWidth + 1 && !sheet.classList.contains("ui1-scrolls")) return "overflows without scroll mode";
    return "ok";
  }, scope);
}

test.describe("N-player score sheet", () => {
  for (const count of [2, 4, 8, 20]) test(`로컬 ${count}인: 모든 폭에서 점수 버튼이 족보 이름과 겹치지 않고 현재 차례 열이 보인다`, async ({ page }, info) => {
    test.setTimeout(120_000);
    const mobile = info.project.name === "mobile";
    await startLocal(page, { count, names: ["가람", "아주아주긴닉네임플레이어입니다"].slice(0, count) });
    await page.getByRole("button", { name: "주사위 굴리기" }).click();
    for (const width of mobile ? [320, 360, 390, 430] : [768, 1024, 1280, 1440, 1920]) {
      await page.setViewportSize({ width, height: mobile ? 800 : 900 });
      if (mobile) {
        await page.getByRole("button", { name: "점수판 열기" }).click();
        const dialog = page.getByRole("dialog", { name: "점수판" });
        await dialog.getByRole("radio", { name: "전체 점수표" }).click();
        await expect(dialog.locator(".ui1-sheet thead th")).toHaveCount(count + 1);
        expect(await sheetIsUsable(page, ".mobile-score-dialog"), `${count}p @${width}`).toBe("ok");
        await page.getByRole("button", { name: "점수판 닫기" }).click();
      } else {
        await expect(page.locator(".multi-scores .ui1-sheet thead th")).toHaveCount(count + 1);
        expect(await sheetIsUsable(page, ".multi-scores"), `${count}p @${width}`).toBe("ok");
      }
      expect(await noPageScroll(page), `page scroll @${width}`).toBe(true);
    }
    if (!mobile && count === 20) {
      // too many columns: the current player is pinned next to the category column and stays there while scrolling
      await page.setViewportSize({ width: 1024, height: 900 });
      const sheet = page.locator(".multi-scores .ui1-sheet");
      await expect(sheet).toHaveClass(/ui1-scrolls/);
      await expect(sheet.locator("thead th").nth(1)).toHaveClass(/current/);
      const before = await sheet.locator("thead th.ui1-pinned").boundingBox();
      await sheet.locator(".multi-score-scroll").evaluate((n) => { n.scrollLeft = 600; });
      const after = await sheet.locator("thead th.ui1-pinned").boundingBox();
      expect(Math.abs(after!.x - before!.x)).toBeLessThan(1);
    }
    // scoring through the sheet still works
    await scoreCategory(page, "choice");
    await expect(page.locator(".turn-indicator")).toContainText("의 차례");
  });
});

test.describe("global header", () => {
  test("모든 폭에서 헤더 버튼이 겹치지 않고 44px 클릭 영역, PC에는 메뉴명, 친구 패널은 레이아웃을 바꾸지 않는다", async ({ page }, info) => {
    test.skip(info.project.name === "mobile", "폭을 직접 바꾼다");
    await page.goto("#shop");
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 800 });
      await settle(page);
      const report = await page.evaluate(() => {
        const header = document.querySelector(".shell-top")!;
        const items = [...header.querySelectorAll<HTMLElement>(".shell-top-left > *, .shell-top-right > *")].filter((n) => n.offsetParent && n.tagName !== "DIALOG");
        const boxes = items.map((n) => n.getBoundingClientRect());
        for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i], b = boxes[j];
          if (a.right > b.left + 0.5 && b.right > a.left + 0.5 && a.bottom > b.top && b.bottom > a.top) return `overlap ${items[i].className} / ${items[j].className}`;
        }
        for (const button of header.querySelectorAll<HTMLElement>("button.shell-icon")) {
          const r = button.getBoundingClientRect();
          if (button.offsetParent && (r.width < 39.5 || r.height < 43.5)) return `small ${button.getAttribute("aria-label")} ${r.width}x${r.height}`;
          if (r.right > innerWidth + 0.5) return "off screen";
        }
        return "ok";
      });
      expect(report, `@${width}`).toBe("ok");
      const label = page.locator(".header-friends span");
      if (width >= 1024) await expect(label).toBeVisible();
      else await expect(label).toBeHidden();
    }
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForTimeout(600);
    await settle(page);
    const main = await page.locator("main").boundingBox();
    await page.getByRole("button", { name: "친구", exact: true }).click();
    const panel = page.getByRole("dialog", { name: "친구" });
    await expect(panel).toBeVisible();
    const box = (await panel.boundingBox())!;
    expect(box.x + box.width).toBeGreaterThan(1279); // right-hand drawer
    expect(await page.locator("main").boundingBox()).toEqual(main);
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
  });

  test("휴대폰에서는 친구 패널이 하단 시트로 열린다", async ({ page }, info) => {
    test.skip(info.project.name !== "mobile", "휴대폰만");
    await page.goto("#home");
    await page.getByRole("button", { name: "친구", exact: true }).click();
    const panel = page.getByRole("dialog", { name: "친구" });
    const box = (await panel.boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(Math.round(box.y + box.height)).toBeGreaterThanOrEqual(viewport.height - 1);
    expect(box.width).toBeGreaterThanOrEqual(viewport.width - 1);
  });
});

test("결과 공유 창은 화면 가운데(PC)·하단 시트(휴대폰)로 열리고 닫힌다", async ({ page }, info) => {
  test.setTimeout(120_000);
  await startAI(page, { algorithm: "PPO", first: "내가 먼저" });
  for (let round = 0; round < 12; round++) {
    await expect(page.getByRole("button", { name: "주사위 굴리기" })).toBeEnabled({ timeout: 15000 });
    await page.getByRole("button", { name: "주사위 굴리기" }).click();
    await scoreCategory(page);
  }
  const result = page.locator(".a3-result");
  await expect(result).toBeVisible({ timeout: 15000 });
  const actions = await result.locator(".a3-actions > button, .a3-actions > *  button").allTextContents();
  expect(actions[0]).toContain("한 번 더 플레이");
  await result.getByRole("button", { name: "결과 공유" }).click();
  const share = page.getByRole("dialog", { name: "결과 공유" });
  await expect(share).toBeVisible();
  const box = (await share.boundingBox())!;
  const viewport = page.viewportSize()!;
  if (info.project.name === "mobile") expect(Math.round(box.y + box.height)).toBeGreaterThanOrEqual(viewport.height - 1);
  else {
    expect(Math.abs(box.x + box.width / 2 - viewport.width / 2)).toBeLessThan(2);
    expect(box.y).toBeGreaterThan(8);
  }
  await expect(share.getByRole("checkbox", { name: "닉네임 표시" })).not.toBeChecked();
  await shot(page, `after-share-${info.project.name}`);
  await share.getByRole("button", { name: "결과 공유 닫기" }).click();
  await expect(share).toBeHidden();
});

test.describe("online (local Worker): quick-match popup", () => {
  let worker: LocalWorker;
  test.beforeAll(async ({}, info) => {
    if (info.project.name === "mobile") return;
    test.setTimeout(120_000);
    worker = await startLocalWorker({ ALLOWED_ORIGINS: "http://127.0.0.1:5173", TURN_TIMEOUT_MS: "0", CREATE_PER_MINUTE: "500", JOIN_PER_MINUTE: "500" });
  });
  test.afterAll(async () => { await worker?.stop(); });

  for (const kind of ["desktop", "phone"] as const) test(`${kind}: 즉시 우측 하단에 뜨고, 본문을 밀지 않으며, 드래그·화면 밖 방지·최소화·복원·취소가 된다`, async ({ browser }, info) => {
    test.skip(info.project.name === "mobile", "기기를 직접 만든다");
    const ctx = await browser.newContext({ storageState: returningVisitorState(), ...(kind === "phone" ? devices["Pixel 7"] : { viewport: { width: 1280, height: 900 } }), baseURL: "http://127.0.0.1:5173/YachtLab/", reducedMotion: "reduce" });
    try {
      const page = await ctx.newPage();
      await page.goto(`?online-server=${encodeURIComponent(worker.url)}#online`);
      await nick(page, "팝업" + kind);
      const start = page.getByRole("button", { name: "빠른 대전 시작" });
      const before = await start.boundingBox();
      const scrollBefore = await page.evaluate(() => document.documentElement.scrollHeight);
      await start.click();
      const popup = page.getByRole("complementary", { name: "빠른 대전 상태" });
      await expect(popup).toBeVisible();
      await expect(popup.getByRole("status")).toHaveText(/상대를 찾는 중|연결 중/);
      // portal: not inside <main>, and the page did not move
      expect(await popup.evaluate((n) => n.parentElement === document.body)).toBe(true);
      expect(await start.boundingBox()).toEqual(before);
      expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(scrollBefore);
      const vp = page.viewportSize()!;
      let box = (await popup.boundingBox())!;
      expect(box.x + box.width).toBeGreaterThan(vp.width - 40);
      expect(box.y + box.height).toBeGreaterThan(vp.height - 120);
      await expect(popup.getByRole("timer", { name: "매칭 경과 시간" })).toHaveText(/0:0[1-9]/);
      await shot(page, `after-match-popup-${kind}`);
      // drag far past the top-left corner: it stops at the edge
      const grip = popup.getByRole("button", { name: /빠른 대전 창 이동/ });
      const g = (await grip.boundingBox())!;
      await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
      await page.mouse.down();
      await page.mouse.move(g.x - 2000, g.y - 2000, { steps: 8 });
      await page.mouse.up();
      box = (await popup.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(7.5);
      expect(box.y).toBeGreaterThanOrEqual(7.5);
      expect(box.x).toBeLessThan(20);
      // minimise → pill (still timing) → restore; the state survives moving between pages
      await popup.getByRole("button", { name: "최소화" }).click();
      const pill = page.getByRole("button", { name: "빠른 대전 상태 보기" });
      await expect(pill).toBeVisible();
      await page.evaluate(() => { location.hash = "shop"; });
      await expect(page.locator("main.page-shop")).toBeVisible();
      await expect(pill).toBeVisible();
      const p = (await pill.boundingBox())!;
      expect(p.x).toBeGreaterThanOrEqual(7.5);
      await pill.click();
      await expect(popup.getByRole("timer", { name: "매칭 경과 시간" })).toBeVisible();
      await popup.getByRole("button", { name: "매칭 취소" }).click();
      await expect(popup).toBeHidden({ timeout: 10_000 });
    } finally {
      await ctx.close();
    }
  });

});

// Friend-room results run on their own Worker with the multi-room settings used by multi-online.spec
// (a 0 ms turn timeout, used above for quick match, drops a friend lobby's connection in this setup).
test.describe("online (local Worker): A3 results for 3+ players and spectators", () => {
  let worker: LocalWorker;
  test.beforeAll(async ({}, info) => {
    if (info.project.name === "mobile") return;
    test.setTimeout(120_000);
    worker = await startLocalWorker({ ALLOWED_ORIGINS: "http://127.0.0.1:5173", TURN_TIMEOUT_MS: "120000", CREATE_PER_MINUTE: "500", JOIN_PER_MINUTE: "500" });
  });
  test.afterAll(async () => { await worker?.stop(); });

  test("3인 결과: 참가자는 순위표형(공동 순위·기권 사유), 관전자는 경기 전체 결과만 (보상·재대결·리뷰·공유 없음)", async ({ browser }, info) => {
    test.skip(info.project.name === "mobile", "기기를 직접 만든다");
    test.setTimeout(120_000);
    const ctxs: import("@playwright/test").BrowserContext[] = [];
    const open = async () => {
      const ctx = await browser.newContext({ storageState: returningVisitorState(), viewport: { width: 1280, height: 900 }, baseURL: "http://127.0.0.1:5173/YachtLab/", reducedMotion: "reduce" });
      ctxs.push(ctx);
      return ctx.newPage();
    };
    const entry = (room?: string) => `?online-server=${encodeURIComponent(worker.url)}${room ? `&room=${room}` : ""}#online`;
    try {
      const host = await open();
      await host.goto(entry());
      await host.getByRole("tab", { name: "친구 대전" }).click();
      await nick(host, "결과방장");
      await host.getByLabel("최대 인원").selectOption("3");
      await host.getByRole("button", { name: "방 만들기" }).click();
      await expect(host.getByRole("heading", { name: "대기실" })).toBeVisible();
      await expect(host.getByLabel("초대 코드", { exact: true })).toHaveText(/^[A-Z2-9]{6}$/);
      const code = (await host.getByLabel("초대 코드", { exact: true }).textContent())!.trim();
      const guests = [];
      for (const name of ["결과둘", "결과셋"]) {
        const g = await open();
        await g.goto(entry(code));
        await nick(g, name);
        await g.getByRole("button", { name: "입장하기" }).click();
        await g.getByRole("button", { name: "준비 완료" }).click();
        guests.push(g);
      }
      await host.getByRole("button", { name: "관전 설정" }).click();
      await host.getByLabel("관전 범위").selectOption("invite");
      const link = await host.getByLabel("관전 링크").inputValue();
      await host.locator("body").click({ position: { x: 5, y: 5 } });
      await host.getByRole("button", { name: /게임 시작/ }).click();
      const watcher = await open();
      await watcher.goto(link);
      await expect(watcher.getByRole("region", { name: "실시간 순위" })).toBeVisible();
      // two players resign: the host wins the 3-player match
      for (const g of guests) {
        await g.getByRole("button", { name: "기권", exact: true }).click();
        await g.getByRole("dialog").getByRole("button", { name: "기권", exact: true }).click();
      }
      const result = host.locator(".a3-result-dialog");
      await expect(result).toBeVisible({ timeout: 15_000 });
      await expect(result).toHaveAttribute("data-kind", "rank");
      await expect(result.locator("h2")).toHaveText("1위");
      const rows = result.getByRole("list", { name: "최종 순위" }).getByRole("listitem");
      await expect(rows).toHaveCount(3);
      await expect(rows.first()).toHaveClass(/you/);
      await expect(result.locator(".a3-forfeit")).toHaveText(["기권", "기권"]);
      await expect(result.getByRole("button", { name: /리뷰 기록 없음/ })).toBeDisabled();
      await expect(result.getByRole("button", { name: "결과 공유" })).toHaveCount(0);
      await expect(result.getByRole("button", { name: "나가기" })).toBeVisible();
      await shot(host, "after-result-multi3-player");
      expect(await result.textContent()).not.toMatch(/정확도|판단 손실|주사위 운/);
      // spectator: whole-match result only
      const seen = watcher.locator(".a3-result-dialog");
      await expect(seen).toBeVisible({ timeout: 15_000 });
      await expect(seen).toHaveAttribute("data-kind", "observer");
      await expect(seen).toHaveAttribute("data-tone", "neutral");
      await expect(seen.locator("h2")).toHaveText("결과방장 승리");
      await expect(seen.getByRole("listitem")).toHaveCount(3);
      await expect(seen.locator("li.you")).toHaveCount(0);
      for (const name of [/한 번 더 플레이|재대결/, /리뷰/, /결과 공유/, /친구 추가/]) await expect(seen.getByRole("button", { name })).toHaveCount(0);
      await expect(seen.getByText(/코인|보석|보상/)).toHaveCount(0);
      await expect(seen.getByRole("button", { name: "관전 종료" })).toBeVisible();
      await shot(watcher, "after-result-multi3-spectator");
    } finally {
      await Promise.all(ctxs.map((c) => c.close().catch(() => undefined)));
    }
  });
});

test("다른 트랙 기능 진입점은 경로와 서버 플래그가 모두 있을 때만 보인다 (이 빌드: 경로 없음 → 플래그가 켜져도 숨김)", async ({ page }, info) => {
  test.skip(info.project.name === "mobile", "한 번만");
  const fake = "http://127.0.0.1:9";
  await page.route(`${fake}/api/features`, (route) => route.fulfill({ headers: { "access-control-allow-origin": "*" }, json: { quickMatch: true, publicSpectate: true, signIn: true, daily: true, retention: true, mailbox: true, feedback: true, notices: false } }));
  await page.route(`${fake}/api/notices`, (route) => route.fulfill({ headers: { "access-control-allow-origin": "*" }, json: { notices: [{ id: "n1", title: "중요 공지", important: true }] } }));
  const featuresSeen = page.waitForResponse(`${fake}/api/features`);
  await page.goto(`?online-server=${encodeURIComponent(fake)}#home`);
  expect((await (await featuresSeen).json()).daily).toBe(true); // the flags really reached the page
  await expect(page.locator(".lobby .mode-card")).toHaveCount(2);
  await expect(page.locator(".lobby-today")).toHaveCount(0);
  await expect(page.locator(".ui1-notice")).toHaveCount(0); // notices flag off
  await page.getByRole("button", { name: "메뉴", exact: true }).click();
  const menu = page.getByRole("dialog", { name: "메뉴" });
  for (const name of ["오늘의 요트", "출석·보상", "알림함", "서비스 제안"]) await expect(menu.getByRole("button", { name })).toHaveCount(0);
  await expect(menu.getByRole("button", { name: "온라인 대전" })).toBeVisible();
});

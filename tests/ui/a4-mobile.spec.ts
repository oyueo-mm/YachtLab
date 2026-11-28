import { returningVisitorState } from "./visitor";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { startLocalWorker, type LocalWorker } from "../helpers/wrangler";
import { nick } from "./helpers";

/**
 * A4 mobile layout of real rooms (isolated local Worker, guests): the subject is a phone-sized viewport
 * in a 2/3/4-player friend room (sequential), the others are desktop guests. Checks what a player needs
 * without scrolling sideways: every player column of the score sheet, the dice and the roll button.
 * Screenshots (A4_SHOTS=<tag>) go to docs/ui/a4-mobile/.
 */
const ORIGIN = "http://127.0.0.1:5173";
let worker: LocalWorker;
const contexts: BrowserContext[] = [];
test.beforeAll(async ({}, info) => {
  if (info.project.name === "mobile") return;
  test.setTimeout(120_000);
  worker = await startLocalWorker({ ALLOWED_ORIGINS: ORIGIN, TURN_TIMEOUT_MS: "0", CREATE_PER_MINUTE: "500", JOIN_PER_MINUTE: "500" });
});
test.afterEach(async () => { await Promise.all(contexts.splice(0).map((c) => c.close().catch(() => undefined))); });
test.afterAll(async () => { await worker?.stop(); });
const entry = (room?: string) => `?online-server=${encodeURIComponent(worker.url)}${room ? `&room=${room}` : ""}#online`;
async function device(browser: Browser, size: { width: number; height: number }, touch: boolean): Promise<Page> {
  const ctx = await browser.newContext({ storageState: returningVisitorState(), viewport: size, deviceScaleFactor: touch ? 2 : 1, hasTouch: touch, isMobile: touch, baseURL: ORIGIN + "/YachtLab/", reducedMotion: "reduce" });
  await ctx.addInitScript(() => localStorage.setItem("yachtlab.settings.v1", JSON.stringify({ muted: true, diceQuality: "2.5d" })));
  contexts.push(ctx);
  return ctx.newPage();
}
const SIZES = [{ name: "320x568", width: 320, height: 568 }, { name: "360x740", width: 360, height: 740 }, { name: "s21-360x800", width: 360, height: 800 }, { name: "390x844", width: 390, height: 844 }, { name: "tablet-768x1024", width: 768, height: 1024 }];

for (const players of [2, 3, 4]) {
  for (const size of SIZES) {
    test(`${players}인 온라인 모바일 ${size.name}: 점수판 열이 가로 스크롤 없이 보이고 굴림 버튼·주사위가 화면 안에 있다`, async ({ browser }, info) => {
      test.skip(info.project.name === "mobile", "sizes are set explicitly");
      test.setTimeout(120_000);
      const phone = size.width < 700;
      const host = await device(browser, size, phone);
      await host.goto(entry());
      await nick(host, "나는방장");
      await host.getByRole("tab", { name: "친구 대전" }).click();
      if (players > 2) await host.getByLabel("최대 인원").selectOption(String(players));
      await host.getByRole("button", { name: "방 만들기" }).click();
      await expect(host.getByRole("heading", { name: "대기실" })).toBeVisible();
      const code = (await host.getByLabel("초대 코드").textContent())!.trim();
      for (const name of ["둘째", "셋째", "넷째"].slice(0, players - 1)) {
        const g = await device(browser, { width: 1280, height: 800 }, false);
        await g.goto(entry(code));
        await nick(g, name);
        await g.getByRole("button", { name: "입장하기" }).click();
        if (players > 2) await g.getByRole("button", { name: "준비 완료" }).click();
      }
      await host.getByRole("button", { name: /게임 시작/ }).click().catch(() => undefined);
      await expect(host.locator(".roll-button")).toBeVisible({ timeout: 20_000 });
      await host.waitForTimeout(400);
      const m = await host.evaluate(() => {
        const vw = innerWidth, vh = innerHeight;
        const q = (s: string) => document.querySelector(s) as HTMLElement | null;
        const r = (e: Element | null) => (e ? e.getBoundingClientRect() : null);
        const sb = q(".scoreboard");
        const scroller = sb?.querySelector(".multi-score-scroll") as HTMLElement | null;
        const heads = sb ? [...sb.querySelectorAll("thead th")].map((th) => th.getBoundingClientRect()) : [];
        const roll = r(q(".roll-button"));
        return {
          docX: document.documentElement.scrollWidth - vw,
          sheetX: scroller ? scroller.scrollWidth - scroller.clientWidth : -1,
          sheetVisible: !!sb && getComputedStyle(sb).display !== "none" && !!r(sb)?.height,
          columnsInside: heads.length > 0 && heads.every((h) => h.left >= -1 && h.right <= vw + 1),
          rollInside: !!roll && roll.bottom <= vh && roll.right <= vw,
          minHead: heads.length ? Math.min(...heads.map((h) => h.width)) : 0,
          vh,
        };
      });
      console.log("A4M", players, size.name, JSON.stringify(m));
      const tag = process.env.A4_SHOTS;
      if (tag) await host.screenshot({ path: `docs/ui/a4-mobile/${tag}-online${players}p-${size.name}.png` });
      if (!process.env.A4_SHOTS_ONLY) {
        expect(m.docX, "page must not scroll sideways").toBeLessThanOrEqual(1);
        if (m.sheetVisible) {
          expect(m.sheetX, "score sheet must not need horizontal scroll").toBeLessThanOrEqual(1);
          expect(m.columnsInside).toBe(true);
        }
      }
    });
  }
}

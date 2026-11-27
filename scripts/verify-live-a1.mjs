#!/usr/bin/env node
/**
 * Post-deploy check of A1 / A1.1 on the live site (read-only for production data).
 *
 *   node scripts/verify-live-a1.mjs [--base https://oyueo-mm.github.io/YachtLab/] [--expect <build prefix>] [--out dir]
 *
 * Offline features run with an offline own-look (no account): Worker API calls of those contexts are
 * blocked so no fake session ever reaches production. The online check only reads: Worker /healthz and
 * /api/auth/config, and the online entry screen renders (no room is created, no match is started).
 * Headless Chromium + SwiftShader: functional checks, not real-device performance.
 */
import { chromium, devices } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const arg = (n, f) => { const i = process.argv.indexOf("--" + n); return i > 0 ? process.argv[i + 1] : f; };
const BASE = arg("base", "https://oyueo-mm.github.io/YachtLab/");
const EXPECT = arg("expect", "");
const OUT = arg("out", "docs/ui/a1-live");
const WORKER = "https://yachtlab-online.hoho96385210.workers.dev";
mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: ok === true ? "pass" : ok === null ? "unverified" : "FAIL", detail });
  console.log(`${ok === true ? "PASS" : ok === null ? "----" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });

async function offline(look = {}, opts = {}) {
  const ctx = await browser.newContext({ ...(opts.device ?? { viewport: { width: 1366, height: 860 } }), reducedMotion: "no-preference" });
  await ctx.route(/workers\.dev|\/api\//, (r) => r.abort()); // never send the offline test session to production
  await ctx.addInitScript(([l, tier]) => {
    const u = "u_" + "a".repeat(22);
    localStorage.setItem("yachtlab.session.v1", "s1." + u + "." + "b".repeat(43));
    localStorage.setItem("yachtlab.own-look.v1", JSON.stringify({ account: u, look: { emotes: [], chats: [], ...l } }));
    localStorage.setItem("yachtlab.settings.v1", JSON.stringify({ muted: true }));
    if (tier !== null) sessionStorage.setItem("yachtlab.fx.tier", String(tier));
  }, [look, opts.tier ?? null]);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return { ctx, page, errors };
}
const history = (page) => page.evaluate(() => window.__yachtlabDice?.history ?? []);
const fxEvents = (page) => page.evaluate(() => (window.__yachtlabFxEvents ?? []).map((e) => e.type));
async function roll(page) {
  const n = (await history(page)).length;
  await page.waitForFunction(() => !document.querySelector(".roll-button")?.disabled, null, { timeout: 30000 });
  await page.locator(".roll-button").click();
  await page.waitForFunction((k) => (window.__yachtlabDice?.history.length ?? 0) > k, n, { timeout: 30000 });
  return (await history(page)).at(-1);
}

// 0. deployed build
const version = await fetch(BASE + "version.json", { cache: "no-store" }).then((r) => r.json()).catch(() => null);
check("배포 빌드 확인 (version.json)", !!version && (!EXPECT || String(version.build).startsWith(EXPECT)), JSON.stringify(version));

// 1. roll, hold / release, values = engine targets, prepared physics, no hover frame
{
  const { ctx, page, errors } = await offline();
  await page.goto(BASE + "#solo");
  const r1 = await roll(page);
  check("주사위 굴림 (3D, 최종 눈 = 엔진 값)", r1?.mode === "3d" && Object.entries(r1.targets).every(([id, v]) => r1.finals?.[id] === v), `mode ${r1?.mode} finals ${JSON.stringify(r1?.finals)}`);
  const die = page.locator('.die-hit[data-die-id="0"]');
  await page.mouse.move(2, 2);
  const before = await die.evaluate((n) => getComputedStyle(n).borderTopColor);
  await die.hover();
  await page.waitForTimeout(200);
  const after = await die.evaluate((n) => getComputedStyle(n).borderTopColor);
  check("주사위 hover 테두리 없음", before === after, `${before} → ${after}`);
  await die.click();
  await page.waitForTimeout(500);
  const held = await die.getAttribute("aria-pressed");
  const r2 = await roll(page);
  const heldKept = !Object.keys(r2.targets).includes("0");
  await die.click();
  await page.waitForTimeout(500);
  const released = await die.getAttribute("aria-pressed");
  check("고정·해제 (고정 주사위는 굴리지 않음)", held === "true" && heldKept && released === "false", `held ${held}, rerolled ${Object.keys(r2.targets)}, released ${released}`);
  const r3 = await roll(page);
  check("다음 던지기 물리 사전 계산 (Web Worker)", r2.prep === "hit" || r3.prep === "hit", `prep: ${r2.prep}, ${r3.prep}`);
  await page.screenshot({ path: `${OUT}/solo-desktop.png` });
  check("페이지 오류 없음 (1인 플레이)", errors.length === 0, errors.join(" | "));
  await ctx.close();
}

// 2. AI match: the AI's throws use the same 3D path
{
  const { ctx, page, errors } = await offline();
  await page.goto(BASE + "#play-setup");
  await page.getByRole("radiogroup", { name: "선공" }).getByText("AI 먼저", { exact: true }).click();
  await page.getByRole("button", { name: "게임 시작" }).click();
  await page.waitForFunction(() => (window.__yachtlabDice?.history ?? []).length >= 1, null, { timeout: 45000 });
  await page.waitForTimeout(4000);
  const h = await history(page);
  check("AI 대전 주사위 연출 (AI 차례도 3D 물리)", h.length >= 1 && h.every((x) => x.mode === "3d") && h.every((x) => Object.entries(x.targets).every(([id, v]) => x.finals?.[id] === v)), `AI throws ${h.length}, modes ${[...new Set(h.map((x) => x.mode))]}`);
  check("페이지 오류 없음 (AI 대전)", errors.length === 0, errors.join(" | "));
  await ctx.close();
}

// 3. boards Lv.1 / 2 / 3
for (const lv of [1, 2, 3]) {
  const { ctx, page, errors } = await offline({ board: "board.storm", boardLv: lv });
  await page.goto(BASE + "#solo");
  await page.locator(".game-board .roll-button").waitFor();
  await page.waitForTimeout(1500);
  const surface = await page.locator(".game-board").getAttribute("data-surface");
  const canvases = await page.locator(".board-fx-canvas").count();
  const f0 = await page.evaluate(() => window.__yachtlabBoardFx?.frames ?? 0);
  await page.waitForTimeout(1000);
  const f1 = await page.evaluate(() => window.__yachtlabBoardFx?.frames ?? 0);
  if (lv === 3) {
    await roll(page).catch(() => null);
  }
  const ev = await fxEvents(page);
  await page.screenshot({ path: `${OUT}/storm-lv${lv}.png` });
  const ok = lv === 1 ? surface === "stone" && canvases === 0 : lv === 2 ? canvases === 1 && f1 > f0 + 10 : canvases === 1 && ev.includes("impact") && ev.includes("land");
  check(`보드판 Lv.${lv} (폭풍 번개)`, ok && errors.length === 0, `surface ${surface}, canvases ${canvases}, frames +${f1 - f0}${lv === 3 ? `, events ${[...new Set(ev)].join("/")}` : ""}`);
  await ctx.close();
}

// 4. collection synergy (lava dice + volcano board)
{
  const { ctx, page, errors } = await offline({ dice: "dice.lava", diceLv: 3, board: "board.volcano", boardLv: 3 });
  await page.goto(BASE + "#solo");
  // the synergy layer is a lazy chunk: wait for it to attach before reading
  await page.locator(".game-board[data-synergy]").waitFor({ timeout: 10000 }).catch(() => {});
  const syn = await page.locator(".game-board").getAttribute("data-synergy");
  await page.locator(".roll-button").click();
  let inked = 0;
  for (let i = 0; i < 12 && inked < 0.002; i++) {
    await page.waitForTimeout(120);
    inked = await page.evaluate(() => {
      const c = document.querySelector(".board-synergy-canvas");
      const g = c?.getContext("2d");
      if (!c || !g) return 0;
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let k = 3; k < d.length; k += 16) if (d[k] > 8) n++;
      return n / (d.length / 16);
    });
  }
  await page.screenshot({ path: `${OUT}/lava-synergy.png` });
  check("컬렉션 시너지 (용암: 이동 경로 그리기)", syn === "lava" && inked > 0.002 && errors.length === 0, `data-synergy ${syn}, inked ${inked.toFixed(4)}`);
  await ctx.close();
}

// 5. shop preview: board Lv tabs, Lv.3 auto throw
{
  const { ctx, page, errors } = await offline();
  await page.goto(BASE + "#shop");
  await page.getByRole("tab", { name: /^보드판/ }).click();
  await page.getByRole("button", { name: "얼음 자세히" }).click();
  const dialog = page.getByRole("dialog", { name: "얼음 상세" });
  const c1 = await dialog.locator(".board-fx-canvas").count();
  await dialog.getByRole("tab", { name: /^Lv\.2/ }).click();
  const lv2 = await dialog.locator(".board-fx-canvas").getAttribute("data-level").catch(() => null);
  const rolls0 = (await fxEvents(page)).filter((e) => e === "roll").length;
  await dialog.getByRole("tab", { name: /^Lv\.3/ }).click();
  await page.waitForTimeout(3000);
  const lv3 = await dialog.locator(".board-fx-canvas").getAttribute("data-level").catch(() => null);
  const rolls1 = (await fxEvents(page)).filter((e) => e === "roll").length;
  await dialog.screenshot({ path: `${OUT}/shop-ice-lv3.png` });
  check("상점 미리보기 (Lv.1 없음 → Lv.2 → Lv.3 자동 굴림)", c1 === 0 && lv2 === "2" && lv3 === "3" && rolls1 > rolls0 && errors.length === 0, `Lv1 canvases ${c1}, Lv2 ${lv2}, Lv3 ${lv3}, auto throws ${rolls1 - rolls0}`);
  await ctx.close();
}

// 6. adaptive graphics quality: desktop stays at tier 0; a forced tier 2 lowers only the decorative canvas
{
  const { ctx, page } = await offline({ dice: "dice.lava", diceLv: 3, board: "board.volcano", boardLv: 3 });
  await page.goto(BASE + "#solo");
  for (let i = 0; i < 3; i++) await roll(page);
  const tier = await page.evaluate(() => window.__yachtlabFxTier?.measured ?? 0);
  const ratio0 = await page.evaluate(() => { const c = document.querySelector(".board-fx-ambient"); return c ? c.width / c.getBoundingClientRect().width : 0; });
  await ctx.close();
  const b = await offline({ dice: "dice.lava", diceLv: 3, board: "board.volcano", boardLv: 3 }, { tier: 2 });
  await b.page.goto(BASE + "#solo");
  await b.page.locator(".roll-button").waitFor();
  await b.page.waitForTimeout(1200);
  const ratio2 = await b.page.evaluate(() => { const c = document.querySelector(".board-fx-ambient"); return c ? c.width / c.getBoundingClientRect().width : 0; });
  const r = await roll(b.page);
  check("적응형 그래픽 품질 (데스크톱 단계 0 유지, 단계 2는 장식 캔버스만 낮춤)", tier === 0 && ratio2 < ratio0 && r.mode === "3d", `measured tier ${tier}, board canvas px/CSS px ${ratio0.toFixed(2)} → tier2 ${ratio2.toFixed(2)}, dice still ${r.mode}`);
  await b.ctx.close();
}

// 7. mobile layout
{
  const { ctx, page, errors } = await offline({ board: "board.meadow", boardLv: 3 }, { device: devices["Pixel 7"] });
  await page.goto(BASE + "#solo");
  await roll(page);
  const layout = await page.evaluate(() => {
    const b = document.querySelector(".roll-button")?.getBoundingClientRect();
    return { overflowX: document.documentElement.scrollWidth - innerWidth, button: b ? b.bottom <= innerHeight + 1 && b.top >= 0 : false };
  });
  const die = page.locator('.die-hit[data-die-id="1"]');
  await die.tap();
  await page.waitForTimeout(500);
  const held = await die.getAttribute("aria-pressed");
  await page.getByRole("button", { name: "점수판 열기" }).click();
  const sheet = await page.getByRole("dialog", { name: "점수판" }).isVisible();
  await page.screenshot({ path: `${OUT}/mobile-meadow.png` });
  check("모바일 레이아웃 (Pixel 7: 가로 넘침 없음, 굴리기 버튼 화면 안, 탭 고정, 점수판)", layout.overflowX <= 0 && layout.button && held === "true" && sheet && errors.length === 0, `overflowX ${layout.overflowX}, button in view ${layout.button}, tap hold ${held}, sheet ${sheet}`);
  await ctx.close();
}

// 8. online compatibility (read-only)
{
  const health = await fetch(WORKER + "/healthz").then(async (r) => [r.status, await r.text()]).catch((e) => [0, String(e)]);
  const auth = await fetch(WORKER + "/api/auth/config", { headers: { Origin: "https://oyueo-mm.github.io" } }).then(async (r) => [r.status, await r.text()]).catch((e) => [0, String(e)]);
  check("Worker 응답 (/healthz, /api/auth/config)", health[0] === 200 && auth[0] === 200, `healthz ${health[0]} ${health[1].slice(0, 60)}, auth ${auth[0]} ${auth[1].slice(0, 60)}`);
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(BASE + "#online");
  // tabs and the quick-match button render; the friend tab shows the room forms (nothing is submitted)
  const quick = await page.getByRole("button", { name: "빠른 대전 시작" }).waitFor({ timeout: 15000 }).then(() => true, () => false);
  await page.getByText("친구 대전", { exact: true }).first().click().catch(() => {});
  const create = await page.getByRole("form", { name: "새 방 만들기" }).waitFor({ timeout: 8000 }).then(() => true, () => false);
  const join = await page.getByRole("form", { name: "방 참가하기" }).isVisible().catch(() => false);
  await page.screenshot({ path: `${OUT}/online-entry.png` });
  check("온라인 대전 진입 화면 (빠른 대전 버튼, 친구 대전 방 만들기·참가 폼, 오류 없음; 방 생성·대전은 하지 않음)", quick && create && join && errors.length === 0, `quick ${quick}, create ${create}, join ${join}, errors ${errors.length}`);
  check("실제 온라인 대전 진행 (2인 접속·매칭)", null, "운영 데이터에 방·전적을 만들지 않기 위해 실행하지 않음 — 미확인");
  await ctx.close();
}

await browser.close();
writeFileSync(`${OUT}/results.json`, JSON.stringify({ base: BASE, version, at: new Date().toISOString(), env: "headless Chromium + SwiftShader (functional check, not a real device)", results }, null, 1));
process.exit(results.some((r) => r.ok === "FAIL") ? 1 : 0);

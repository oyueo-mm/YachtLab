import { expect, test, type Page } from "@playwright/test";
import { startOnlineServer } from "../../server/online/server";
import { scoreCategory } from "./helpers";
import { categories, createGame, transition, type Action } from "../../src/engine";
import type { Replay } from "../../src/replay";

// These cases need to hold the dedicated Worker request independently of the PWA cache.
test.use({ serviceWorkers: "block" });

async function seedReview(page: Page) {
  const initialState = createGame(40);
  const players: Replay["metadata"]["players"] = [{ name: "복기A", type: "human" }, { name: "복기B", type: "human" }];
  const replay: Replay = {
    format: "YachtLabReplay", version: 1,
    metadata: { id: "review-fixture", name: "복기 테스트", createdAt: new Date().toISOString(), ruleVersion: "YachtLab-12-v1", players },
    initialState, finalState: initialState,
    frames: [{ state: initialState, action: null, actor: 0, label: "시작", actorName: players[0].name }],
  };
  const act = (action: Action) => {
    const { player } = replay.finalState;
    replay.finalState = transition(replay.finalState, action);
    replay.frames.push({ action, state: replay.finalState, actor: player, label: action.type, actorName: players[player].name });
  };
  for (const category of categories) {
    for (let seat = 0; seat < 2; seat++) {
      act({ type: "roll" });
      act({ type: "roll" });
      act({ type: "roll" });
      act({ type: "score", category });
    }
  }
  await page.goto("#records");
  await page.evaluate(async (saved) => {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open("YachtLabReplays", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("replays", { keyPath: "metadata.id" });
      req.onsuccess = () => {
        const transaction = req.result.transaction("replays", "readwrite");
        transaction.objectStore("replays").put(saved);
        transaction.oncomplete = () => { req.result.close(); resolve(); };
        transaction.onerror = () => reject(transaction.error);
      };
      req.onerror = () => reject(req.error);
    });
  }, replay);
  await page.getByRole("button", { name: "새로고침" }).click();
}

test("저장된 1:1 기보의 게임 리뷰에서 그래프와 다시 도전을 선택한다", async ({ page }) => {
  await seedReview(page);
  let release = () => {};
  let onRequest = () => {};
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const requested = new Promise<void>((resolve) => { onRequest = resolve; });
  const workerModule = "**/assets/product-worker-*.js";
  await page.route(workerModule, async (route) => {
    onRequest();
    await blocked;
    await route.continue().catch(() => {});
  });
  await page.getByRole("button", { name: "게임 리뷰" }).click();
  const review = page.getByRole("dialog", { name: "게임 리뷰" });
  await requested;
  await review.getByRole("button", { name: "분석 취소" }).click();
  release();
  await page.unroute(workerModule);
  await review.getByRole("button", { name: "분석 다시 시도" }).click();
  await expect(review.getByRole("tabpanel", { name: "기본 리뷰" })).toBeVisible();
  await review.getByRole("tab", { name: "상세 분석" }).click();
  await expect(review.getByRole("group", { name: "승리점수율 그래프" })).toBeVisible({ timeout: 30_000 });
  await expect(review.getByText(/첫 굴림 운/)).toBeVisible();
  await expect(review.getByRole("main")).toBeVisible();
  await expect(review.getByRole("table", { name: "당시 점수판" })).toBeVisible();
  expect(await review.evaluate((surface) => surface.scrollWidth)).toBeLessThanOrEqual(await review.evaluate((surface) => surface.clientWidth));
  await expect(review.getByRole("list", { name: "행동 타임라인" }).locator("[aria-current=step]")).toHaveCount(1);
  if (test.info().project.name === "mobile") {
    const board = await review.locator(".review-position").boundingBox();
    const summary = await review.getByRole("region", { name: "경기 전체 분석" }).boundingBox();
    expect(board!.y).toBeLessThan(summary!.y);
  }
  await review.getByText("대안 행동", { exact: true }).click();
  await review.getByRole("button", { name: "다시 도전" }).click();
  await expect(review.getByText("당시 점수판을 보고 선택해 보세요.")).toBeVisible();
  await review.locator(".review-options ol button").first().click();
  await expect(review.locator(".review-options").getByRole("status")).toContainText(/최선/);
  await review.getByRole("button", { name: "분석으로 돌아가기" }).click();
  const win = review.getByRole("group", { name: "승리점수율 그래프" });
  const plot = win.getByRole("img");
  const bounds = await plot.boundingBox();
  await plot.click({ position: { x: bounds!.width - 14, y: bounds!.height / 2 } });
  await expect(win.locator("output")).toHaveText(/라운드 .*%/);
  await review.getByRole("button", { name: "처음", exact: true }).click();
  await expect(review.getByText("최종 점수차 분포")).toBeVisible();
  await expect(review.getByRole("button", { name: /^1번째 행동/ })).toHaveAttribute("aria-current", "step");
  await review.getByRole("button", { name: "돌아가기" }).click();
  await expect(review).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => new Promise<number>((resolve, reject) => {
    const request = indexedDB.open("YachtLabReview", 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const count = db.transaction("analysis").objectStore("analysis").count();
      count.onsuccess = () => { db.close(); resolve(count.result); };
      count.onerror = () => { db.close(); reject(count.error); };
    };
  }))).toBe(1);
  let requestedAgain = false;
  await page.route(workerModule, async (route) => { requestedAgain = true; await route.abort(); });
  await page.reload();
  await page.getByRole("button", { name: "게임 리뷰" }).click();
  await expect(review.getByText(/판단 정확도 추정/).first()).toBeVisible();
  expect(requestedAgain).toBe(false);
});

test("온라인 경기 중 복기는 숨기고 서버가 종료한 본인 경기를 분석한다", async ({ page, browser, baseURL }) => {
  test.setTimeout(90_000);
  const origin = new URL(baseURL!).origin;
  const worker = await startOnlineServer({ port: 0, dataDir: null, allowedOrigins: [origin] });
  const guest = await browser.newContext({ baseURL, reducedMotion: "reduce" });
  try {
    await page.addInitScript(() => localStorage.setItem("yachtlab.visited.v1", "1"));
    const other = await guest.newPage();
    await other.addInitScript(() => localStorage.setItem("yachtlab.visited.v1", "1"));
    const entry = `?online-server=${encodeURIComponent(worker.url)}`;
    await page.goto(entry + "#online");
    await page.getByRole("button", { name: "방 만들기", exact: true }).click();
    const lobby = page.getByRole("region", { name: "대기실" });
    const invite = lobby.getByLabel("초대 코드", { exact: true });
    await expect(invite).toHaveText(/^[A-Z2-9]{6}$/);
    await other.goto(entry + "&room=" + await invite.innerText() + "#online");
    await other.getByRole("button", { name: "입장하기", exact: true }).click();
    await other.getByRole("heading", { name: "대기실" }).waitFor();
    await lobby.getByRole("button", { name: "게임 시작", exact: true }).click();
    await page.locator(".roll-button").click();
    await scoreCategory(page, "choice");
    await expect(page.getByRole("button", { name: "게임 리뷰" })).toHaveCount(0);
    await other.getByRole("button", { name: "기권", exact: true }).click();
    await other.getByRole("dialog").getByRole("button", { name: "기권", exact: true }).click();
    await page.getByRole("button", { name: "게임 리뷰" }).click();
    await page.getByRole("tab", { name: "상세 분석" }).click();
    await expect(page.getByRole("group", { name: "승리점수율 그래프" })).toBeVisible({ timeout: 55_000 });
  } finally {
    await guest.close();
    await worker.close();
  }
});


test("기본 대전 리뷰는 중반 추정과 정확 종반을 구분하고 값이 없는 확률을 표시하지 않는다", async ({ page }) => {
  await seedReview(page);
  await page.getByRole("button", { name: "게임 리뷰" }).click();
  const review = page.getByRole("dialog", { name: "게임 리뷰" });
  await review.getByRole("tab", { name: "상세 분석" }).click();
  const win = review.getByRole("group", { name: "승리점수율 그래프" });
  await expect(win).toBeVisible({ timeout: 35_000 });
  await expect(review.getByText("모델 추정", { exact: true })).toBeVisible();
  await review.getByText("분석 정보", { exact: true }).click();
  await expect(review.getByText(/내 선택의 예상 승리 .* 무승부 .* 패배/)).toBeVisible();
  await review.getByRole("combobox", { name: "그래프" }).selectOption("winLuck");
  await expect(review.getByRole("group", { name: "승리점수율 기준 주사위 운 그래프" }).locator("output")).toContainText("%p");
  await review.getByRole("button", { name: "마지막", exact: true }).click();
  await expect(review.getByText("정확 종반", { exact: true })).toBeVisible();
  await expect(review.getByText(/내 선택의 예상 승리 .* 무승부 .* 패배/)).toHaveCount(0);
});

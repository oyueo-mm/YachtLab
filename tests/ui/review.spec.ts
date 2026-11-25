import { expect, test } from "@playwright/test";
import { startOnlineServer } from "../../server/online/server";
import { scoreCategory } from "./helpers";
import { categories, createGame, transition, type Action } from "../../src/engine";
import type { Replay } from "../../src/replay";

test("저장된 1:1 기보의 Worker 복기에서 그래프와 복습을 선택한다", async ({ page }) => {
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
  let release = () => {};
  let onRequest = () => {};
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const requested = new Promise<void>((resolve) => { onRequest = resolve; });
  const workerModule = "**/assets/review-worker-*.js";
  await page.route(workerModule, async (route) => {
    onRequest();
    await blocked;
    await route.continue().catch(() => {});
  });
  await page.getByRole("button", { name: "AI 복기" }).click();
  const review = page.getByRole("dialog", { name: "AI 복기" });
  await requested;
  await review.getByRole("button", { name: "분석 취소" }).click();
  release();
  await page.unroute(workerModule);
  await review.getByRole("button", { name: "분석 다시 시도" }).click();
  await expect(review.getByRole("group", { name: "기대점수 그래프" })).toBeVisible({ timeout: 30_000 });
  await expect(review.getByText(/결정 손실 .* 굴림 운/)).toBeVisible();
  if (test.info().project.name === "mobile") {
    const board = await review.locator(".review-position").boundingBox();
    const summary = await review.getByRole("region", { name: "경기 전체 분석" }).boundingBox();
    expect(board!.y).toBeLessThan(summary!.y);
  }
  await review.getByRole("button", { name: "이 국면 복습하기" }).click();
  await expect(review.getByText("당시 점수판을 보고 선택해 보세요.")).toBeVisible();
  await review.locator(".review-options ol button").first().click();
  await expect(review.locator(".review-options").getByRole("status")).toContainText(/기대점수/);
  const win = review.getByRole("group", { name: "종반 승리점수율 그래프" });
  await win.getByRole("button").last().click();
  await expect(review.getByText("최종 점수차 분포")).toBeVisible();
});

test("온라인 경기 중 복기는 숨기고 서버가 종료한 본인 경기를 분석한다", async ({ page, browser, baseURL }) => {
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
    await expect(page.getByRole("button", { name: "AI 복기" })).toHaveCount(0);
    await other.getByRole("button", { name: "기권", exact: true }).click();
    await other.getByRole("dialog").getByRole("button", { name: "기권", exact: true }).click();
    await page.getByRole("button", { name: "AI 복기" }).click();
    await expect(page.getByRole("group", { name: "기대점수 그래프" })).toBeVisible({ timeout: 30_000 });
  } finally {
    await guest.close();
    await worker.close();
  }
});

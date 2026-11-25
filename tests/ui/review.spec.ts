import { expect, test } from "@playwright/test";
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
  await page.getByRole("button", { name: "AI 복기" }).click();
  const review = page.getByRole("dialog", { name: "AI 복기" });
  await expect(review.getByRole("group", { name: "기대점수 그래프" })).toBeVisible({ timeout: 30_000 });
  await expect(review.getByText(/결정 손실 .* 굴림 운/)).toBeVisible();
  await review.getByRole("button", { name: "이 국면 복습하기" }).click();
  await expect(review.getByText("당시 점수판을 보고 선택해 보세요.")).toBeVisible();
  await review.locator(".review-options ol button").first().click();
  await expect(review.locator(".review-options").getByRole("status")).toContainText(/기대점수/);
  const win = review.getByRole("group", { name: "종반 승리점수율 그래프" });
  await win.getByRole("button").last().click();
  await expect(review.getByText("최종 점수차 분포")).toBeVisible();
});

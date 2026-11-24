import { expect, test } from "@playwright/test";

// 경제 연구실: precomputed research results + in-browser re-run of the simulator (research only).
test("경제 연구실은 결과 탭을 보여 주고 브라우저에서 시뮬레이터를 다시 실행한다", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("#economy-lab");
  await expect(page.getByRole("heading", { name: "경제 연구실" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /추천: M3/ })).toBeVisible({ timeout: 15000 });
  for (const tab of ["모델 비교", "사용자 유형", "퀘스트·업적", "가격·강화", "어뷰징·서버", "민감도"]) {
    await page.getByRole("tab", { name: tab }).click();
    await expect(page.getByRole("tab", { name: tab })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("econ-panel")).not.toBeEmpty();
  }
  await page.getByRole("tab", { name: "모델 비교" }).click();
  await expect(page.getByTestId("econ-model-table").locator("tbody tr")).toHaveCount(7);
  await page.getByRole("tab", { name: "직접 실행" }).click();
  await page.getByLabel("기간(일)").fill("30");
  await page.getByRole("button", { name: "시뮬레이션 실행" }).click();
  await expect(page.getByTestId("econ-run-result")).toContainText("코인/일", { timeout: 20000 });
  expect(errors).toEqual([]);
});

import { test, expect } from "@playwright/test";
import { aiReplay, seedReplays, soloReplay } from "./review-fixtures";

// Screenshot capture for the A5 PR. Skipped unless REVIEW_SHOTS is set.
test.skip(!process.env.REVIEW_SHOTS, "screenshots only");
test.use({ serviceWorkers: "block" });
const dir = process.env.REVIEW_SHOTS!;

for (const kind of ["ai", "solo", "same"] as const) test(`shot ${kind}`, async ({ page }, info) => {
  test.setTimeout(120_000);
  const ai = kind === "ai" ? [aiReplay()] : kind === "same" ? [aiReplay(["요트", "요트"], "same-names", 91)] : [];
  await seedReplays(page, { ai, multi: kind === "solo" ? [soloReplay()] : [] });
  await page.getByRole("button", { name: "게임 리뷰" }).first().click();
  const review = page.getByRole("dialog", { name: "게임 리뷰" });
  await expect(review.getByText(/분석 완료|저장된 분석/)).toBeVisible({ timeout: 90_000 });
  const p = info.project.name;
  await page.screenshot({ path: `${dir}/${kind}-${p}-top.png`, fullPage: false });
  if (kind !== "solo") {
    await review.getByRole("button", { name: "마지막", exact: true }).click();
    await review.getByRole("region", { name: "경기 전체 분석" }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${dir}/${kind}-${p}-endgame.png` });
  }
  const mistake = review.getByRole("region", { name: "주요 장면" }).locator(".mistakes button").first();
  if (await mistake.count()) await mistake.click();
  await review.locator(".review-position").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${dir}/${kind}-${p}-mistake.png` });
  await review.getByRole("radio", { name: "손실·운" }).click();
  await review.getByRole("radio", { name: "실수" }).click();
  await review.getByRole("region", { name: "경기 전체 분석" }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${dir}/${kind}-${p}-summary.png` });
  await review.getByRole("region", { name: "주요 장면" }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${dir}/${kind}-${p}-moments.png` });
});

test("shot online", async ({ page, browser, baseURL }, info) => {
  test.setTimeout(120_000);
  const { startOnlineServer } = await import("../../server/online/server");
  const { scoreCategory } = await import("./helpers");
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
    await other.getByRole("button", { name: "기권", exact: true }).click();
    await other.getByRole("dialog").getByRole("button", { name: "기권", exact: true }).click();
    await page.getByRole("button", { name: "게임 리뷰" }).click();
    const review = page.getByRole("dialog", { name: "게임 리뷰" });
    await expect(review.getByText(/분석 완료|저장된 분석/)).toBeVisible({ timeout: 90_000 });
    await page.screenshot({ path: `${dir}/online-${info.project.name}-top.png` });
  } finally {
    await guest.close();
    await worker.close();
  }
});

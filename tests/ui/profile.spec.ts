import { expect, test } from "@playwright/test";
import { scoreCategory, startAI } from "./helpers";

/**
 * Profile & guest records (Phase 4). The dev server has no online server and no sign-in, so these
 * tests cover the guest experience; account flows are tested against a fake identity provider in
 * tests/accounts.test.ts (not a real Google sign-in).
 */
test("빈 프로필은 가짜 수치 없이 안내하고, 로그인은 준비 중으로 표시한다", async ({ page }) => {
  await page.goto("#profile");
  await expect(page.getByRole("heading", { name: /이름 없음|.+/ })).toBeVisible();
  await expect(page.getByText("아직 기록이 없어요.")).toBeVisible();
  await expect(page.getByText("회원 로그인은 준비 중이에요.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Google로 로그인" })).toHaveCount(0);
  await expect(page.getByText(/브라우저 데이터를 지우면 함께 사라져요/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("AI 대전 12라운드를 끝내면 기기 기록과 통계가 프로필에 쌓인다(로그인 강제 없음)", async ({ page }) => {
  test.setTimeout(120000);
  await startAI(page, { algorithm: "Random", name: "요트왕", first: "내가 먼저" });
  for (let round = 0; round < 12; round++) {
    await expect(page.getByRole("button", { name: "주사위 굴리기" })).toBeEnabled({ timeout: 15000 });
    await page.getByRole("button", { name: "주사위 굴리기" }).click();
    await scoreCategory(page);
  }
  await expect(page.locator(".game-result")).toBeVisible({ timeout: 15000 });
  await page.goto("#profile");
  await expect(page.locator(".profile-stats")).toContainText("경기");
  await expect(page.locator(".profile-stats div").first()).toContainText("1");
  await expect(page.locator(".profile-recent li")).toHaveCount(1);
  await expect(page.locator(".profile-recent")).toContainText("매우 쉬움");
  await expect(page.locator(".profile-recent")).toContainText("기기 기록");
  await page.getByText("상세 통계").click();
  await expect(page.locator(".profile-details")).toContainText("AI 난이도별");
  await page.getByRole("radio", { name: "온라인" }).check({ force: true });
  await expect(page.getByText("아직 기록이 없어요.")).toBeVisible();
});

test("닉네임: 사칭·빈 이름 거부, 정상 이름 저장(긴 이름은 말줄임)", async ({ page }) => {
  await page.goto("#profile");
  await page.getByRole("button", { name: "닉네임 바꾸기" }).click();
  const input = page.getByLabel("닉네임");
  await input.fill("운영자");
  await page.getByRole("button", { name: "저장" }).click();
  await expect(page.getByText("운영자·관리자로 보일 수 있는 닉네임은 쓸 수 없어요.")).toBeVisible();
  await input.fill("   ");
  await page.getByRole("button", { name: "저장" }).click();
  await expect(page.getByText("닉네임을 입력해 주세요.")).toBeVisible();
  await input.fill("주사위의달인열두글자임");
  await page.getByRole("button", { name: "저장" }).click();
  await expect(page.locator(".profile-name")).toHaveText("주사위의달인열두글자임");
  const box = await page.locator(".profile-name").evaluate((e) => ({ w: e.scrollWidth, c: e.clientWidth, vw: innerWidth }));
  expect(box.c).toBeLessThanOrEqual(box.vw);
  // The same name is used for online play (one display name on this device).
  expect(await page.evaluate(() => localStorage.getItem("yachtlab.online.name"))).toBe("주사위의달인열두글자임");
});

test("홈에서 프로필로 바로 갈 수 있다", async ({ page }) => {
  await page.goto("#home");
  await page.getByRole("navigation", { name: "내 메뉴" }).getByRole("button", { name: "프로필" }).click();
  await expect(page.locator(".profile")).toBeVisible();
});

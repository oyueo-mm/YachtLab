import { expect, test } from "@playwright/test";
import { startOnlineServer, type RunningOnlineServer } from "../../server/online/server";

let server: RunningOnlineServer;
test.beforeEach(async ({ baseURL }) => {
  server = await startOnlineServer({ port: 0, dataDir: null, allowedOrigins: [new URL(baseURL!).origin] });
});
test.afterEach(async () => await server?.close());

test("방 생성 설정과 코드 참가를 구분하고 생성 직후 설정·초대 코드·링크를 보여 준다", async ({ page }) => {
  await page.goto(`?online-server=${encodeURIComponent(server.url)}#online`);
  const create = page.getByRole("form", { name: "새 방 만들기" });
  const join = page.getByRole("form", { name: "방 참가하기" });
  await expect(join.getByLabel("초대 코드")).toBeVisible();
  await expect(join.getByLabel("진행 방식")).toHaveCount(0);
  await create.getByLabel("최대 인원").selectOption("3");
  await create.getByLabel("진행 방식").selectOption("simultaneous");
  await create.getByLabel("라운드 제한 시간").selectOption("60000");
  await create.getByRole("button", { name: "방 만들기" }).click();
  await expect(page.getByRole("heading", { name: "대기실" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "동시 진행" })).toBeChecked();
  await expect(page.getByLabel("제한 시간")).toHaveValue("60000");
  const code = (await page.getByLabel("초대 코드").textContent())?.trim();
  expect(code).toMatch(/^[A-Z2-9]{6}$/);
  await expect(page.getByLabel("초대 링크")).toHaveValue(new RegExp(`room=${code}`));
  await expect(page.getByRole("button", { name: "초대 코드 복사" })).toBeVisible();
  await expect(page.getByRole("button", { name: "초대 링크 복사" })).toBeVisible();
});

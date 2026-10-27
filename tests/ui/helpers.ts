import type { Page } from "@playwright/test";
export async function chooseAlgorithm(
  page: Page,
  label: string,
  value: string,
) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name: value, exact: true }).click();
}

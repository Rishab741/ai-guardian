import { expect, test } from "@playwright/test";

const SHOTS = process.env.E2E_SCREENSHOTS;

test("compliance check shows the same prompt judged differently by role", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Continue with Microsoft Entra ID" }).click();
  await page.getByRole("button", { name: /Margaret Ellis/ }).click();
  await page.waitForURL(/dashboard/);
  await page.goto("/evaluate");
  const person = page.locator("#eval-person");
  await expect(person.locator("option", { hasText: "Retail Banking" }).first()).toBeAttached();
  const value = await person.locator("option", { hasText: "Retail Banking" }).first().getAttribute("value");
  await person.selectOption(value!);
  await page.getByRole("button", { name: "Check compliance" }).click();
  await expect(page.getByText("Verdict for this person")).toBeVisible();
  await expect(page.locator("section", { hasText: "Verdict for this person" }).getByText("Blocked", { exact: true })).toBeVisible();
  const legal = page.locator("tr", { hasText: "Legal & Risk" });
  await expect(legal.getByText("Allowed", { exact: true })).toBeVisible();
  await expect(legal.getByText(/⟦AU_MEDICARE_1⟧/)).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/compliance-check.png`, fullPage: true });
});

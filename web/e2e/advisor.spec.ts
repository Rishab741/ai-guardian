import { expect, test } from "@playwright/test";

const SHOTS = process.env.E2E_SCREENSHOTS;
const TFN = "123 456 782";

test.describe.configure({ mode: "serial" });

test("one-line swap: direct sends the TFN out, the gateway keeps it inside", async ({ page }) => {
  await page.goto("/advisor");
  await expect(page.getByText("Advisor Assist").first()).toBeVisible();
  await expect(page.locator("#advisor option").first()).not.toHaveText("Advisor");

  // Before: direct to the provider. The raw TFN is in the outbound payload.
  await page.locator("aside button", { hasText: "home loan pre-approval" }).click();
  const payload = page.locator("text=What left the bank").locator("..");
  await expect(payload.locator("mark", { hasText: TFN })).toBeVisible({ timeout: 45_000 });
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/advisor-direct.png` });

  // After: flip the switch, same prompt. Only a token leaves; the answer still has the real TFN.
  await page.getByRole("switch").click();
  await expect(page.getByText(/One line changed/)).toBeVisible();
  await page.locator("aside button", { hasText: "home loan pre-approval" }).click();
  await expect(payload.locator("mark", { hasText: "⟦AU_TFN_1⟧" })).toBeVisible({ timeout: 45_000 });
  await expect(payload.locator("mark", { hasText: TFN })).toHaveCount(0);
  await expect(page.getByText(/Protected by SovereignFabric/)).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/advisor-gateway.png` });

  // Health data is out of scope for retail advisors: blocked, nothing sent.
  await page.locator("aside button", { hasText: "Medicare" }).click();
  await expect(page.getByText("Blocked by Harbour Bank policy")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Nothing was sent/)).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/advisor-blocked.png` });
});

test("presenter triggers a scenario and it appears in the live feed", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Continue with Microsoft Entra ID" }).click();
  await page.getByRole("button", { name: /Margaret Ellis/ }).click();
  await page.waitForURL(/dashboard/);
  await expect(page.getByText("streaming")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Presenter" }).click();
  await page.getByRole("button", { name: "Card data sent to a vendor model" }).click();
  await expect(page.locator("li", { hasText: "sim" }).filter({ hasText: "Blocked" }).first()).toBeVisible({ timeout: 10_000 });
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/presenter.png` });
});

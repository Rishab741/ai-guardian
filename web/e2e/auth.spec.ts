import { expect, test, type Page } from "@playwright/test";

const SHOTS = process.env.E2E_SCREENSHOTS;

async function signInAs(page: Page, name: string) {
  await page.goto("/login");
  await page.getByRole("button", { name: "Continue with Microsoft Entra ID" }).click();
  await page.getByRole("button", { name: new RegExp(name) }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

test("signed-out visitors are sent to sign in", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

test("executive lands on the dashboard and cannot open the playground", async ({ page }) => {
  await signInAs(page, "Margaret Ellis");
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByText("Executive", { exact: true })).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/exec-dashboard.png`, fullPage: false });
  await page.goto("/chat");
  await expect(page.getByRole("heading", { name: "Gateway Playground is restricted" })).toBeVisible();
});

test("developer is kept out of executive views", async ({ page }) => {
  await signInAs(page, "Jess Park");
  await expect(page).toHaveURL(/\/chat/);
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Executive Dashboard is restricted" })).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/developer-restricted.png` });
});

test("CISO sends a prompt through the playground and sees the redaction trace", async ({ page }) => {
  await signInAs(page, "Daniel Okoye");
  await page.goto("/chat");
  await page.locator("textarea").fill("Draft a reply confirming TFN 123 456 782 was updated");
  await page.keyboard.press("Enter");
  await page.getByText("View compliance pipeline").first().click({ timeout: 45_000 });
  await expect(page.getByText("PII/PHI Redaction").first()).toBeVisible();
  await expect(page.getByText(/tokenized before leaving the boundary/).first()).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/ciso-playground.png` });
});

import { expect, test, type Page } from "@playwright/test";

const SHOTS = process.env.E2E_SCREENSHOTS;
const API = process.env.E2E_API_URL ?? "http://localhost:8000";

async function signInAs(page: Page, name: string) {
  await page.goto("/login");
  await page.getByRole("button", { name: "Continue with Microsoft Entra ID" }).click();
  await page.getByRole("button", { name: new RegExp(name) }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

test.describe.configure({ mode: "serial" });

test("CISO proposes a policy change and an executive approves it", async ({ browser }) => {
  const term = `Project Osprey ${Date.now() % 10000}`;

  const ciso = await (await browser.newContext()).newPage();
  await signInAs(ciso, "Daniel Okoye");
  await ciso.goto("/policies");
  await ciso.getByRole("button", { name: "Propose a change" }).click();
  const terms = ciso.locator("#deny-terms");
  await terms.fill(`${await terms.inputValue()}, ${term}`);
  await ciso.getByRole("button", { name: "Estimate impact" }).click();
  await expect(ciso.getByText("newly blocked").first()).toBeVisible();
  await ciso.locator("#proposal-note").fill("Add the Osprey acquisition codename to restricted terms");
  if (SHOTS) await ciso.screenshot({ path: `${SHOTS}/policy-editor.png`, fullPage: true });
  await ciso.getByRole("button", { name: "Submit for approval" }).click();
  await expect(ciso.getByText(/two-person rule/)).toBeVisible();

  const exec = await (await browser.newContext()).newPage();
  await signInAs(exec, "Margaret Ellis");
  await expect(exec.getByText(/is waiting for approval/).first()).toBeVisible();
  await exec.goto("/policies");
  await expect(exec.getByText(`Restricted terms added: ${term}`)).toBeVisible();
  if (SHOTS) await exec.screenshot({ path: `${SHOTS}/policy-approval.png` });
  await exec.getByRole("button", { name: "Approve and activate" }).click();
  await expect(exec.getByText(new RegExp(`Restricted terms: .*${term}`))).toBeVisible();
});

test("live feed shows a request the moment it happens, and people drill-down works", async ({ page, request }) => {
  await signInAs(page, "Margaret Ellis");
  await expect(page.getByText("streaming")).toBeVisible({ timeout: 15_000 });

  const login = await (await request.get(`${API}/api/auth/config`)).json();
  const ciso = login.personas.find((p: { role: string }) => p.role === "ciso");
  const { token } = await (await request.post(`${API}/api/auth/demo-login`, { data: { persona_id: ciso.id } })).json();
  await request.post(`${API}/api/chat`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { message: "Send card 4111 1111 1111 1111 to the vendor", department: "technology" },
  });
  await expect(page.getByText("Blocked").first()).toBeVisible({ timeout: 10_000 });
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/command-centre.png` });

  await page.goto("/risk");
  await page.locator("ul button").first().click();
  await expect(page.getByText("Recent requests")).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/risk.png` });
});

test("compliance generates the evidence pack", async ({ page }) => {
  await signInAs(page, "Fatima Rahman");
  await page.goto("/reports");
  await expect(page.getByText("1.4 Audit trail integrity")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Intact ·/)).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/evidence.png`, fullPage: true });
});

test("IT admin connects a new app and sends a test request through it", async ({ page }) => {
  await signInAs(page, "Chris Lam");
  await page.goto("/setup");
  await page.getByRole("button", { name: /Connect an app/ }).click();
  await page.locator("#app-name").fill(`Mortgage Assistant ${Date.now() % 100000}`);
  await page.getByRole("button", { name: "Create app and key" }).click();
  await expect(page.getByText(/copy it now/)).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: /Send a test request/ }).click();
  await page.getByRole("button", { name: "Send through the gateway" }).click();
  // Live model: allow for a busy model and the fallback to the next tier.
  await expect(page.getByText(/identifier\(s\) tokenized before the model saw them/)).toBeVisible({ timeout: 90_000 });
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/setup-test.png` });
});

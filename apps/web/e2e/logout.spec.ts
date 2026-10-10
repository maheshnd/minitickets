import { expect, test } from "@playwright/test";

// 1. A new account on every run, created through the signup page (no database access needed).
const runId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const email = `logout-${runId}@example.com`;
const password = "correct-horse-battery";

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page.getByText("Account created. Login comes next.")).toBeVisible();
  await page.close();
});

test("logout shows Login / Sign up and stays logged out after a reload", async ({ page }) => {
  // 2. Log in.
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  const header = page.getByRole("banner");
  await expect(header.getByText(`Signed in as ${email}`)).toBeVisible();

  // 3. Log out: we land on / and the header shows the logged-out links.
  await header.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL("/");
  await expect(header.getByRole("link", { name: "Login" })).toBeVisible();
  await expect(header.getByRole("link", { name: "Sign up" })).toBeVisible();
  await expect(header.getByText("Signed in as")).toHaveCount(0);

  // 4. A full reload asks the API again; the cookie is gone, so we are still logged out.
  await page.reload();
  await expect(header.getByRole("link", { name: "Login" })).toBeVisible();
  await expect(header.getByText("Signed in as")).toHaveCount(0);
});

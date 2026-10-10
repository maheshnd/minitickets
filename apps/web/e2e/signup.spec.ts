import { expect, test, type Page } from "@playwright/test";

// 1. A new email on every run, so the test does not fail on a row from an earlier run.
const runId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const password = "correct-horse-battery";

async function fillForm(page: Page, email: string) {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
}

test("valid signup shows the success message", async ({ page }) => {
  await page.goto("/signup");
  await fillForm(page, `valid-${runId}@example.com`);
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page.getByText("Account created. Login comes next.")).toBeVisible();
});

test("same email in a different case shows 409 under the email field", async ({ page }) => {
  const email = `dup-${runId}@example.com`;
  await page.goto("/signup");

  // 2. First signup creates the account.
  await fillForm(page, email);
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page.getByText("Account created. Login comes next.")).toBeVisible();

  // 3. Same email, upper case: the server lowercases it, so it is a duplicate.
  await fillForm(page, email.toUpperCase());
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page.locator("#email-error")).toHaveText("Email already registered");
});

test("the button is disabled while the request is pending", async ({ page }) => {
  // 4. Hold every API call for a moment so we can look at the button mid-request.
  await page.route("**/trpc/**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue();
  });

  await page.goto("/signup");
  await fillForm(page, `pending-${runId}@example.com`);
  await page.getByRole("button", { name: "Sign up" }).click();

  await expect(page.getByRole("button", { name: "Creating account..." })).toBeDisabled();
  await expect(page.getByText("Account created. Login comes next.")).toBeVisible();
});

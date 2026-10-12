import { expect, test } from "@playwright/test";

// @concept: e2e-tests
// 1. A new email on every run. The account is created through the signup page's API call,
//    so the test needs no database access.
const runId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const email = `login-${runId}@example.com`;
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

test("login shows the email in the header and survives a reload", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();

  // 2. After login we land on / and the header shows who we are.
  await expect(page).toHaveURL("/");
  const header = page.getByRole("banner");
  await expect(header.getByText(`Signed in as ${email}`)).toBeVisible();
  await expect(header.getByRole("link", { name: "Login" })).toHaveCount(0);

  // @concept: session-cookie
  // 3. The session cookie is HttpOnly: page JavaScript can't see it.
  expect(await page.evaluate(() => document.cookie)).not.toContain("sid");

  // 4. A full reload asks the API again; the cookie keeps us logged in.
  await page.reload();
  await expect(header.getByText(`Signed in as ${email}`)).toBeVisible();
});

test("wrong password shows the error and stays logged out", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("not-the-password");
  await page.getByRole("button", { name: "Log in" }).click();

  // Scoped to the form: Next.js has its own role="alert" element for route announcements.
  await expect(page.locator("form").getByRole("alert")).toHaveText("Invalid email or password");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("banner").getByRole("link", { name: "Login" })).toBeVisible();
});

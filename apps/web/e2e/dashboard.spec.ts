import { expect, test } from "@playwright/test";

// 1. A new account on every run, created through the signup page (no database access needed).
const runId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const email = `dashboard-${runId}@example.com`;
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

async function logIn(page: import("@playwright/test").Page) {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
}

test("logged out, /dashboard sends you to login, and login brings you back", async ({ page }) => {
  // 2. Logged out: the route guard redirects, remembering where we wanted to go.
  await page.goto("/dashboard");
  await expect(page).toHaveURL("/login?next=%2Fdashboard");

  // 3. Log in from there: we land on the dashboard, which shows our email.
  await logIn(page);
  await expect(page).toHaveURL("/dashboard");
  await expect(page.getByRole("main").getByText(email)).toBeVisible();
  await expect(page.getByRole("main").getByText(/^Member since /)).toBeVisible();
  await expect(page.getByRole("banner").getByRole("link", { name: "Dashboard" })).toBeVisible();
});

test("an external ?next= is ignored after login (no open redirect)", async ({ page }) => {
  await page.goto("/login?next=https://evil.com");
  await logIn(page);

  // 4. We end up on our own home page, not on evil.com.
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("banner").getByText(`Signed in as ${email}`)).toBeVisible();
});

test("a fake sid cookie passes the route guard but the API's 401 sends us to login", async ({ page, context, baseURL }) => {
  // @concept: route-guard-proxy
  // 5. The proxy only checks that a cookie exists, so this gets past it. The API says 401
  //    (no such session) and the profile hook redirects. This shows the guard is UX only.
  //    The cookie is set for baseURL (localhost locally, the CloudFront address with E2E_BASE_URL),
  //    so the browser sends it to whichever app is under test.
  await context.addCookies([{ name: "sid", value: "not-a-real-session", url: baseURL }]);
  await page.goto("/dashboard");
  await expect(page).toHaveURL("/login?next=/dashboard");
});

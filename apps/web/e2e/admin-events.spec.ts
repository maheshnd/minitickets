import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

// 1. Making an admin needs the make-admin script, which talks to the LOCAL database. Against a
//    deployed app (E2E_BASE_URL) we cannot do that, so these tests are skipped there.
test.skip(!!process.env.E2E_BASE_URL && process.env.P4_E2E !== "1" && process.env.E2E_LOCAL_API !== "1", "needs the local database to make an admin");

// 2. Fixed time zone, so the date we type into the datetime-local input means the same moment
//    on every machine (the input takes the browser's local time).
test.use({ timezoneId: "UTC" });

// 3. New accounts and a new event title on every run.
const runId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const adminEmail = `admin-${runId}@example.com`;
const userEmail = `user-${runId}@example.com`;
const password = "correct-horse-battery";
const eventTitle = `E2E Launch Party ${runId}`;
const REPO_ROOT = path.join(__dirname, "..", "..", "..");
// Where the API is when we call it directly (step 11). Same default as apps/web/.env.example.
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

async function signUp(page: Page, email: string) {
  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page.getByText("Account created. Login comes next.")).toBeVisible();
}

async function logIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("banner").getByText(`Signed in as ${email}`)).toBeVisible();
}

test.beforeAll(async ({ browser }) => {
  // 4. Two normal accounts through the signup page, then make one of them admin with the script
  //    (there is no UI for roles). It reads apps/api/.env locally, the job's env vars in CI.
  const page = await browser.newPage();
  await signUp(page, adminEmail);
  await signUp(page, userEmail);
  await page.close();
  execFileSync("pnpm", ["--filter", "@minitickets/api", "user:make-admin", adminEmail], { cwd: REPO_ROOT, stdio: "pipe" });
});

test("an admin creates an event and it is on /events right away (cache invalidated)", async ({ page }) => {
  await logIn(page, adminEmail);
  const main = page.getByRole("main");

  // 5. Look at /events BEFORE creating. This fills the API's Redis cache (and this browser's
  //    React Query cache) with a list that does not have the new event. Without invalidation that
  //    old list would keep being served until its next refresh (soft TTL, ~30 s).
  await page.goto("/events");
  await expect(main.getByRole("heading", { name: "Indie Rock Showcase" })).toBeVisible();
  await expect(main.getByRole("heading", { name: eventTitle })).toHaveCount(0);

  // 6. Open the form through the admin-only header link.
  await page.getByRole("banner").getByRole("link", { name: "New event" }).click();
  await expect(page).toHaveURL("/admin/events/new");

  // 7. Fill it in and submit. The event starts in one hour, so it is near the top of the list.
  //    datetime-local wants "YYYY-MM-DDTHH:mm" in local time, which is UTC here (step 2).
  const startsAt = new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 16);
  await main.getByLabel("Title").fill(eventTitle);
  await main.getByLabel("Venue").fill("Test Hall");
  await main.getByLabel("Starts at").fill(startsAt);
  await main.getByLabel("Total seats").fill("42");
  await main.getByRole("button", { name: "Create event" }).click();
  await expect(main.getByRole("status")).toContainText(`Event “${eventTitle}” created.`);

  // 8. Straight to the list: the new event is there at once, no waiting for a TTL.
  //    First by following the link (client-side navigation), then with a full reload, which renders
  //    on the web server and goes through the API's cache again.
  await main.getByRole("link", { name: "See upcoming events" }).click();
  await expect(page).toHaveURL("/events");
  await expect(main.getByRole("heading", { name: eventTitle })).toBeVisible();
  await page.reload();
  await expect(main.getByRole("heading", { name: eventTitle })).toBeVisible();
});

test("the server-rendered /events shows a new event at once, not after the web cache's 30 s (revalidate hook)", async ({ page }) => {
  await logIn(page, adminEmail);
  const title = `E2E Revalidate ${runId}`;

  // 12. Ask the web SERVER for /events (page.request: a plain HTTP request, no browser, no
  //     JavaScript, so this is exactly the HTML the server rendered). This fills the web server's
  //     data cache (Next.js, 30 s) with a list WITHOUT the new event; the second request is a hit.
  for (let i = 0; i < 2; i++) {
    const html = await (await page.request.get("/events")).text();
    expect(html).toContain("Indie Rock Showcase");
    expect(html).not.toContain(title);
  }

  // 13. Create the event as the admin. Straight through the API (page.request shares the admin's
  //     session cookie); the UI path is the first test in this file. The API saves it, bumps the
  //     Redis generation, then calls the web server's POST /api/revalidate (fire-and-forget).
  const response = await page.request.post(`${API_URL}/trpc/events.create`, {
    data: { title, venue: "Test Hall", startsAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(), totalSeats: 7 },
  });
  expect(response.status()).toBe(200);
  const createdAt = Date.now();

  // 14. The server's HTML has the new event almost at once. We allow 5 s (the hook is
  //     fire-and-forget, so it can land a few ms after the API answered), far below the 30 s the
  //     web cache would otherwise keep the old list. Without the hook this step fails.
  const serverHtmlHasIt = async () => (await (await page.request.get("/events")).text()).includes(title);
  await expect
    .poll(serverHtmlHasIt, { message: "new event in the server-rendered /events", timeout: 5_000, intervals: [100] })
    .toBe(true);
  expect(Date.now() - createdAt).toBeLessThan(5_000);

  // 15. And in the browser: a full reload renders on the server and shows it.
  await page.goto("/events");
  await page.reload();
  await expect(page.getByRole("main").getByRole("heading", { name: title })).toBeVisible();
});

test("a normal user cannot create events: no link, 'not allowed' page, and the API says 403", async ({ page }) => {
  await logIn(page, userEmail);

  // 9. No admin link in the header.
  await expect(page.getByRole("banner").getByRole("link", { name: "New event" })).toHaveCount(0);

  // 10. Typing the address gets past the route guard (it only checks for a cookie), but the page
  //     shows "not allowed" and no form.
  await page.goto("/admin/events/new");
  await expect(page.getByRole("main").getByText("You are not allowed to create events")).toBeVisible();
  await expect(page.getByRole("button", { name: "Create event" })).toHaveCount(0);

  // 11. The page is not the real protection, the API is. Calling events.create directly, with this
  //     user's session cookie (page.request shares the browser's cookies), is refused with 403.
  const response = await page.request.post(`${API_URL}/trpc/events.create`, {
    data: { title: "Sneaky", venue: "Nowhere", startsAt: new Date(Date.now() + 86_400_000).toISOString(), totalSeats: 1 },
  });
  expect(response.status()).toBe(403);
});

test("logged out, /admin/events/new sends you to login", async ({ page }) => {
  await page.goto("/admin/events/new");
  await expect(page).toHaveURL("/login?next=%2Fadmin%2Fevents%2Fnew");
});

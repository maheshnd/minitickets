import { expect, test, type Page } from "@playwright/test";

// Booking tickets (Feature 2, step F2a). Uses two SEEDED events (apps/api/src/db/seed.ts, run
// `pnpm --filter @minitickets/api db:seed` first), so no admin and no database access are needed:
// - "Symphony Under the Stars" has many seats (640 of 1000 left in the seed). Each run books 2, so
//   the test reads the number BEFORE booking and checks it went down by exactly 2.
// - "Sold Out Gala Dinner" has 0 seats left.
const SYMPHONY_ID = "00000000-0000-4000-8000-000000000006";
const SOLD_OUT_ID = "00000000-0000-4000-8000-000000000008";

// 1. A new account on every run, so "My tickets" holds only this run's booking.
const runId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const email = `booker-${runId}@example.com`;
const password = "correct-horse-battery";

async function fillLogin(page: Page) {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("banner").getByText(`Signed in as ${email}`)).toBeVisible();
}

// 2. The "N of M seats left" line of the event page, as the number N.
async function seatsLeft(page: Page): Promise<number> {
  const text = await page.getByRole("main").getByText(/\d+ of \d+ seats left/).textContent();
  return Number(text!.match(/(\d+) of/)![1]);
}

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

test("log in, open an event from /events, book 2 tickets: success, seats left -2, and My tickets shows it", async ({ page }) => {
  await page.goto("/login");
  await fillLogin(page);
  const main = page.getByRole("main");

  // 3. The event card's title links to the event page.
  await page.goto("/events");
  await main.getByRole("link", { name: "Symphony Under the Stars" }).click();
  await expect(page).toHaveURL(`/events/${SYMPHONY_ID}`);
  await expect(main.getByRole("heading", { level: 1, name: "Symphony Under the Stars" })).toBeVisible();
  await expect(page).toHaveTitle("Symphony Under the Stars | MiniTickets");
  const before = await seatsLeft(page);

  // 4. Book 2. The success message links to My tickets.
  await main.getByLabel("Tickets", { exact: true }).selectOption("2");
  await main.getByRole("button", { name: "Book ticket" }).click();
  await expect(main.getByRole("status")).toContainText("Booked! You have 2 tickets.");

  // 5. Seats left went down by exactly 2: at once on this page (the booking invalidated the
  //    event's query), and after a reload too (rendered on the server, read from Postgres).
  await expect.poll(() => seatsLeft(page)).toBe(before - 2);
  await page.reload();
  expect(await seatsLeft(page)).toBe(before - 2);

  // 6. My tickets (through the header link) shows this booking: the event and 2 tickets.
  await page.getByRole("banner").getByRole("link", { name: "My tickets" }).click();
  await expect(page).toHaveURL("/tickets");
  await expect(main.getByRole("heading", { level: 1, name: "My tickets" })).toBeVisible();
  const booking = main.getByRole("listitem").filter({ hasText: "Symphony Under the Stars" });
  await expect(booking).toHaveCount(1);
  await expect(booking).toContainText("2 tickets");
});

test("a sold-out event shows 'Sold out' and the Book ticket button is disabled", async ({ page }) => {
  await page.goto(`/events/${SOLD_OUT_ID}`);
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { level: 1, name: "Sold Out Gala Dinner" })).toBeVisible();
  await expect(main.getByText("Sold out", { exact: true })).toBeVisible();
  await expect(main.getByRole("button", { name: "Book ticket" })).toBeDisabled();
});

test("logged out, Book ticket sends you to login, and logging in brings you back to the event", async ({ page }) => {
  await page.goto(`/events/${SYMPHONY_ID}`);
  // 7. Wait until the header knows we are logged out (the button is disabled until then).
  await expect(page.getByRole("banner").getByRole("link", { name: "Login" })).toBeVisible();
  await page.getByRole("main").getByRole("button", { name: "Book ticket" }).click();

  await expect(page).toHaveURL(`/login?next=${encodeURIComponent(`/events/${SYMPHONY_ID}`)}`);
  await fillLogin(page);
  await expect(page).toHaveURL(`/events/${SYMPHONY_ID}`);
  await expect(page.getByRole("main").getByRole("button", { name: "Book ticket" })).toBeEnabled();
});

test("logged out, /tickets sends you to login", async ({ page }) => {
  await page.goto("/tickets");
  await expect(page).toHaveURL("/login?next=%2Ftickets");
});

test("an unknown or malformed event id is a 404 page", async ({ page }) => {
  for (const id of ["00000000-0000-4000-8000-0000000000ff", "not-a-uuid"]) {
    const response = await page.goto(`/events/${id}`);
    expect(response!.status()).toBe(404);
    await expect(page.getByText("This page could not be found.")).toBeVisible();
  }
});

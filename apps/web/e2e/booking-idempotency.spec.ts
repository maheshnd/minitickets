import { expect, test, type Page, type Route } from "@playwright/test";

// A lost response must not become a second booking (Feature 2, step F2b).
// The browser sends "Book 2 tickets"; the request REACHES the API and the booking is saved, but the
// browser never gets the answer (we throw it away). The booking mutation retries (network error),
// with the SAME idempotency key, and the API answers with the booking it already made.
// Without the key, the retry would book 2 more seats.
//
// Uses the SEEDED event "Open Air Cinema" (apps/api/src/db/seed.ts, 600 seats; run
// `pnpm --filter @minitickets/api db:seed` first). No other spec books it, so its seat count only
// moves because of this test (bookings.spec.ts books "Symphony Under the Stars", possibly at the
// same time in another worker). Each run books 2.
const OPEN_AIR_ID = "00000000-0000-4000-8000-00000000000b";

// 1. A new account on every run, so "My tickets" holds only this run's booking.
const runId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const email = `idem-${runId}@example.com`;
const password = "correct-horse-battery";

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

test("the first booking response is lost, the client retries with the same key: ONE booking, seats down once", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("banner").getByText(`Signed in as ${email}`)).toBeVisible();

  const main = page.getByRole("main");
  await page.goto(`/events/${OPEN_AIR_ID}`);
  await expect(main.getByRole("heading", { level: 1, name: "Open Air Cinema" })).toBeVisible();
  const before = await seatsLeft(page);

  // 3. Catch every bookings.create request the browser sends (the URL is <api>/trpc/bookings.create
  //    ?batch=1; the API may be another origin locally). For each POST we note its idempotency key
  //    (tRPC's batch body is { "0": <input> }).
  //    - the FIRST one: route.fetch() sends it to the API for real (the booking is saved), and we
  //      keep the API's answer to check it; then route.abort() makes the BROWSER see a network
  //      error, as if the connection dropped on the way back.
  //    - every later one (the retry): passed through untouched.
  const keys: string[] = [];
  const firstServerAnswer: { status?: number; bookingId?: string } = {};
  await page.route(/\/trpc\/bookings\.create/, async (route: Route) => {
    const request = route.request();
    if (request.method() !== "POST") return route.continue();
    keys.push((request.postDataJSON() as Record<string, { idempotencyKey: string }>)["0"].idempotencyKey);
    if (keys.length > 1) return route.continue();

    const response = await route.fetch();
    const body = (await response.json()) as [{ result?: { data: { id: string } } }];
    firstServerAnswer.status = response.status();
    firstServerAnswer.bookingId = body[0].result?.data.id;
    await route.abort("connectionreset");
  });

  // 4. Book 2. The first answer is lost; React Query retries after ~1 s, and the retry's answer
  //    (the SAME booking) is what the form shows.
  await main.getByLabel("Tickets", { exact: true }).selectOption("2");
  await main.getByRole("button", { name: "Book ticket" }).click();
  await expect(main.getByRole("status")).toContainText("Booked! You have 2 tickets.", { timeout: 10_000 });
  await expect(main.getByRole("alert")).toHaveCount(0);

  // 5. The first request really booked on the server, and the retry carried the SAME key.
  expect(firstServerAnswer.status).toBe(200);
  expect(firstServerAnswer.bookingId).toBeTruthy();
  expect(keys).toHaveLength(2);
  expect(keys[1]).toBe(keys[0]);

  // 6. Seats left went down by 2, ONCE: on this page, and after a reload (read from Postgres).
  await expect.poll(() => seatsLeft(page)).toBe(before - 2);
  await page.unroute(/\/trpc\/bookings\.create/);
  await page.reload();
  expect(await seatsLeft(page)).toBe(before - 2);

  // 7. My tickets: exactly ONE booking for this event, with 2 tickets.
  await page.goto("/tickets");
  await expect(main.getByRole("heading", { level: 1, name: "My tickets" })).toBeVisible();
  const booking = main.getByRole("listitem").filter({ hasText: "Open Air Cinema" });
  await expect(booking).toHaveCount(1);
  await expect(booking).toContainText("2 tickets");
});

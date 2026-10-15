import { expect, test } from "@playwright/test";

// These titles come from the seed (apps/api/src/db/seed.ts): run `pnpm --filter @minitickets/api db:seed` first.
test("/events shows upcoming seeded events, not past ones, and the sold out badge", async ({ page }) => {
  await page.goto("/events");
  const main = page.getByRole("main");

  // 1. Upcoming events are listed.
  await expect(main.getByRole("heading", { name: "Indie Rock Showcase" })).toBeVisible();
  await expect(main.getByRole("heading", { name: "Symphony Under the Stars" })).toBeVisible();

  // 2. Past events (the seed marks them "(past)") are not.
  await expect(main.getByRole("heading", { name: /\(past\)/ })).toHaveCount(0);

  // 3. The sold out event has the badge; an event with seats left does not.
  const soldOut = main.getByRole("listitem").filter({ hasText: "Sold Out Gala Dinner" });
  await soldOut.scrollIntoViewIfNeeded();
  await expect(soldOut.getByText("Sold out", { exact: true })).toBeVisible();
  const available = main.getByRole("listitem").filter({ hasText: "Indie Rock Showcase" });
  await expect(available.getByText("Sold out", { exact: true })).toHaveCount(0);

  // 4. The header has an Events link.
  await expect(page.getByRole("banner").getByRole("link", { name: "Events" })).toBeVisible();
});

// @concept: csr-vs-ssr
// @concept: streaming-suspense
test.describe("with JavaScript disabled", () => {
  test.use({ javaScriptEnabled: false });

  test("the server's HTML already contains the event titles (server rendering)", async ({ page }) => {
    // 1. No JavaScript runs, so nothing can fetch in the browser: whatever is here came from the server.
    const response = await page.goto("/events");
    const html = await response!.text();
    expect(html).toContain("Indie Rock Showcase");
    expect(html).toContain("Symphony Under the Stars");

    // 2. The titles are real elements in the page, not just text inside a script.
    //    They are "attached", not "visible": with streaming, React sends the finished list in a
    //    hidden <div> after the skeleton, and a small inline script swaps it in. Without JavaScript
    //    that swap never runs, so a no-JS visitor still sees the skeleton (see docs/22-events-ssr.md).
    await expect(page.getByRole("heading", { name: "Indie Rock Showcase", includeHidden: true })).toBeAttached();
    await expect(page).toHaveTitle("Upcoming events | MiniTickets");
  });
});

// @concept: hydration
test("the browser makes no events.search request: hydration reuses the server's data", async ({ page }) => {
  // 1. Record every request the BROWSER sends. (The web server's own call to the API happens on
  //    the server, so Playwright never sees it.) The tRPC client batches, so a browser fetch would
  //    show up as /trpc/events.search or /trpc/auth.me,events.search: matching "events.search" catches both.
  const eventsCalls: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("events.search")) eventsCalls.push(request.url());
  });

  // 2. Load the page and wait for the header's auth.me call. It is sent by a query after React has
  //    hydrated, so when it arrives every query on the page has had its chance to fetch.
  const authMe = page.waitForResponse((response) => response.url().includes("auth.me"));
  await page.goto("/events");
  await authMe;
  await page.waitForLoadState("networkidle");

  // 3. The events are on screen, yet the browser never asked the API for them.
  await expect(page.getByRole("main").getByRole("heading", { name: "Indie Rock Showcase" })).toBeVisible();
  expect(eventsCalls).toEqual([]);
});

test("filter by venue: only matching events; reload keeps the filter (server-rendered); clear filters shows all", async ({ page }) => {
  const main = page.getByRole("main");
  const filters = page.getByRole("search", { name: "Filter events" });
  await page.goto("/events");

  // 1. Odd case and spaces on purpose: the API treats " the FOUNDRY " like "The Foundry".
  await filters.getByLabel("Venue").fill("  the FOUNDRY ");
  await filters.getByRole("button", { name: "Apply" }).click();

  // 2. The filter is in the URL (trimmed), and only events at The Foundry are listed.
  await expect(page).toHaveURL("/events?venue=the+FOUNDRY");
  await expect(main.getByRole("heading", { name: "Indie Rock Showcase" })).toBeVisible();
  await expect(main.getByRole("heading", { name: "Symphony Under the Stars" })).toHaveCount(0);
  for (const card of await main.getByRole("listitem").all()) await expect(card).toContainText(/the foundry/i);

  // 3. Reload. The SERVER renders the filtered list: its HTML has the matching event and not the
  //    others. And the browser asks for no events.search: hydration found the server's data under the
  //    key that includes the filter (same as the unfiltered hydration test above).
  const eventsCalls: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("events.search")) eventsCalls.push(request.url());
  });
  const authMe = page.waitForResponse((response) => response.url().includes("auth.me"));
  const response = await page.reload();
  const html = await response!.text();
  expect(html).toContain("Indie Rock Showcase");
  expect(html).not.toContain("Symphony Under the Stars");
  await authMe;
  await page.waitForLoadState("networkidle");
  await expect(filters.getByLabel("Venue")).toHaveValue("the FOUNDRY");
  await expect(main.getByRole("heading", { name: "Indie Rock Showcase" })).toBeVisible();
  expect(eventsCalls).toEqual([]);

  // 4. Clear filters: back to /events, every upcoming event, an empty venue box.
  await filters.getByRole("link", { name: "Clear filters" }).click();
  await expect(page).toHaveURL("/events");
  await expect(main.getByRole("heading", { name: "Indie Rock Showcase" })).toBeVisible();
  await expect(main.getByRole("heading", { name: "Symphony Under the Stars" })).toBeVisible();
  await expect(filters.getByLabel("Venue")).toHaveValue("");
  await expect(filters.getByRole("link", { name: "Clear filters" })).toHaveCount(0);
});

// The old test "a failing API shows the error message and a Retry button" was removed in Step 22.
// It made the BROWSER's events.search call fail with page.route(), but the browser no longer makes
// that call (the test above proves it), and Playwright cannot reach the web server's call to the
// API. The failure paths (API down -> the browser fetches itself; missing API_INTERNAL_URL ->
// app/events/error.tsx) were checked by hand on a separate server; see docs/22-events-ssr.md.

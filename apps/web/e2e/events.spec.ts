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
  await expect(soldOut.getByText("Sold out", { exact: true })).toBeVisible();
  const available = main.getByRole("listitem").filter({ hasText: "Indie Rock Showcase" });
  await expect(available.getByText("Sold out", { exact: true })).toHaveCount(0);

  // 4. The header has an Events link.
  await expect(page.getByRole("banner").getByRole("link", { name: "Events" })).toBeVisible();
});

test("a failing API shows the error message and a Retry button that recovers", async ({ page }) => {
  // 1. Make the first events.list calls fail (a 500), then let later calls through.
  //    The leading * matters: the tRPC client batches calls made together, so the URL can be
  //    /trpc/auth.me,events.list (the header's "me" query travels in the same request).
  let calls = 0;
  await page.route("**/trpc/*events.list*", (route) => {
    calls += 1;
    return calls <= 3 ? route.fulfill({ status: 500, contentType: "application/json", body: "{}" }) : route.continue();
  });
  await page.goto("/events");

  // 2. The query retries twice on a 500 (retry-policy), then shows the error.
  //    (Next.js also has an invisible role="alert" element, so we pick ours by its text.)
  await expect(page.getByRole("alert").filter({ hasText: "Something went wrong" })).toBeVisible({ timeout: 10_000 });

  // 3. Retry works.
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByRole("main").getByRole("heading", { name: "Indie Rock Showcase" })).toBeVisible();
});

import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

// 1. Isolated demo only: deliberate burst tests must never throttle the owner's dev IP/users.
test.skip(process.env.P8_DEMO !== "1", "Run demo:sale for isolated Redis namespace + DB");
const api = process.env.P8_API_URL ?? "http://127.0.0.1:4101";
test("booking/user and login/IP limits return 429, Retry-After and no-store", async ({ page }) => {
  const email = `sale-${randomUUID()}@example.com`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("correct-horse-battery");
  await page.getByLabel("Confirm password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page.getByText("Account created. Login comes next.")).toBeVisible();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("banner").getByText(`Signed in as ${email}`)).toBeVisible();
  // 2. Sold-out attempts consume budget too. They cannot evade the user bucket with fresh keys.
  const books = await Promise.all(Array.from({ length: 15 }, () => page.request.post(`${api}/trpc/bookings.create`, {
    data: { eventId: "00000000-0000-4000-8000-000000000008", quantity: 1, idempotencyKey: randomUUID() },
  })));
  expect(books.some(response => response.status() === 409)).toBe(true);
  expect(books.some(response => response.status() === 429)).toBe(true);
  for (const response of books.filter(response => response.status() === 429)) {
    expect(Number(response.headers()["retry-after"])).toBeGreaterThanOrEqual(1);
    expect(response.headers()["cache-control"]).toBe("no-store");
    expect((await response.json()).error.data.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  }
  const bookingLimit = await books.find(response => response.status() === 429)!.json();
  await page.goto("/events/00000000-0000-4000-8000-000000000004");
  await expect(page.getByRole("main").getByRole("heading", { name: "Indie Rock Showcase" })).toBeVisible();
  await page.route("**/trpc/*bookings.create*", route => route.fulfill({ status: 429, json: [bookingLimit] }));
  await page.getByRole("button", { name: "Book ticket", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Too many requests");
  // 3. Untrusted X-Forwarded-For cannot create new IP buckets (local trustProxy=0).
  const logins = await Promise.all(Array.from({ length: 30 }, (_, i) => page.request.post(`${api}/trpc/auth.login`, {
    data: { email, password: "wrong-password" }, headers: { "x-forwarded-for": `198.51.100.${i + 1}` },
  })));
  expect(logins.some(response => response.status() === 401)).toBe(true);
  const limited = logins.find(response => response.status() === 429)!;
  expect(limited).toBeDefined(); expect(Number(limited.headers()["retry-after"])).toBeGreaterThanOrEqual(1);
  // 4. Render the real 429 through the browser transport; its bucket may refill during navigation.
  //    Server enforcement above is real; this isolates message rendering from that refill race.
  const body = await limited.json();
  await page.route("**/trpc/*auth.login*", route => route.fulfill({ status: 429, json: [body] }));
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("wrong-password");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Too many requests");
});

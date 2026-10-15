import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

// 1. The isolated demo starts a real worker and local AWS emulators. Normal CI without those
//    dependencies skips this spec; the other booking/admin specs still run there as before.
test.skip(process.env.P4_E2E !== "1", "run pnpm demo:p4-assets for the isolated full pipeline");
test.setTimeout(60_000);
const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const EVENT = "00000000-0000-4000-8000-000000000006";
const POSTER = path.join(__dirname, "fixtures/poster.png");
const apiCwd = path.resolve(__dirname, "../../api");
const password = "correct-horse-battery";

async function login(page: Page, admin = false) {
  const email = `p4-${randomUUID()}@example.com`;
  expect((await page.request.post(`${API}/trpc/auth.signup`, { data: { email, password, confirmPassword: password } })).status()).toBe(200);
  if (admin) execFileSync(process.execPath, ["--import", "tsx", "src/scripts/make-admin.ts", email], { cwd: apiCwd, stdio: "pipe" });
  expect((await page.request.post(`${API}/trpc/auth.login`, { data: { email, password } })).status()).toBe(200);
}

test("being created becomes two QR tickets with a PNG download", async ({ page }) => {
  await login(page);
  expect((await page.request.post(`${API}/trpc/bookings.create`, { data: { eventId: EVENT, quantity: 2, idempotencyKey: randomUUID() } })).status()).toBe(200);
  let pendingShown = false;
  // 2. Hold the first browser snapshot in the valid pending state, even on a fast emulator.
  //    The next poll uses the REAL API/worker result, so the transition is deterministic.
  await page.route("**/trpc/**", async route => {
    if (pendingShown || !route.request().url().includes("tickets.mine")) return route.continue();
    const response = await route.fetch(); const json = await response.json();
    for (const result of Array.isArray(json) ? json : [json]) {
      if (Array.isArray(result.result?.data)) for (const booking of result.result.data) {
        if ("creationStatus" in booking) { booking.creationStatus = "creating"; booking.tickets = []; pendingShown = true; }
      }
    }
    await route.fulfill({ response, json });
  });
  await page.goto("/tickets");
  await expect(page.getByText("Your tickets are being created.", { exact: false })).toBeVisible();
  const qr = page.getByRole("img", { name: /QR code for ticket/ });
  await expect(qr).toHaveCount(2);
  await expect.poll(() => qr.first().evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  const downloading = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download ticket 1", exact: true }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/^ticket-.*-1\.png$/);
  expect(readFileSync((await download.path())!).subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  await expect(page.getByText("Your tickets are being created.", { exact: false })).toHaveCount(0);
});

test("ticket URLs require a session, use no-store, and cannot select another owner", async ({ page }) => {
  expect((await page.request.get(`${API}/trpc/tickets.mine`)).status()).toBe(401);
  await login(page);
  const response = await page.request.get(`${API}/trpc/tickets.mine?input=${encodeURIComponent(JSON.stringify({ userId: randomUUID() }))}`);
  expect(response.status()).toBe(200); expect(response.headers()["cache-control"]).toBe("no-store");
  expect((await response.json()).result.data).toEqual([]);
});

test("admin uploads directly, sees the poster, and an upload replay cannot replace it", async ({ page }) => {
  await login(page, true);
  let putUrl = "";
  page.on("request", request => { if (request.method() === "PUT" && request.url().includes("poster-uploads")) putUrl = request.url(); });
  await page.goto(`/events/${EVENT}`);
  await page.getByLabel("Poster image").setInputFiles(POSTER);
  await page.getByRole("button", { name: "Upload poster", exact: true }).click();
  await expect(page.getByText("Poster uploaded.", { exact: true })).toBeVisible();
  const poster = page.getByRole("img", { name: "Poster for Symphony Under the Stars" });
  await expect.poll(() => poster.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(32);
  expect(putUrl).toBeTruthy();
  // 3. A bearer PUT can be reused until expiry, but only its staging key changes. The
  //    published copy remains intact, and a second completion rejects the invalid bytes.
  const corrupt = Buffer.alloc(readFileSync(POSTER).length, 65);
  expect((await page.request.put(putUrl, { headers: { "content-type": "image/png", "x-amz-server-side-encryption": "AES256" }, data: corrupt })).status()).toBe(200);
  const uploadId = new URL(putUrl).pathname.split("/").at(-1)!;
  expect((await page.request.post(`${API}/trpc/posters.complete`, { data: { eventId: EVENT, uploadId } })).status()).toBe(400);
  await page.reload();
  await expect.poll(() => poster.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(32);
});

test("normal users cannot upload; admins cannot request SVG or oversized capabilities", async ({ page }) => {
  await login(page);
  await page.goto(`/events/${EVENT}`);
  await expect(page.getByRole("button", { name: "Upload poster", exact: true })).toHaveCount(0);
  expect((await page.request.post(`${API}/trpc/posters.start`, { data: { eventId: EVENT, contentType: "image/png", byteLength: 64 } })).status()).toBe(403);
  await page.request.post(`${API}/trpc/auth.logout`, { data: {} });
  await login(page, true);
  for (const data of [{ contentType: "image/svg+xml", byteLength: 64 }, { contentType: "image/png", byteLength: 2 * 1024 * 1024 + 1 }]) {
    expect((await page.request.post(`${API}/trpc/posters.start`, { data: { eventId: EVENT, ...data } })).status()).toBe(400);
  }
});

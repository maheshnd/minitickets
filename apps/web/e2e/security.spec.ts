// @concept: accessible-forms
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
const api = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
const secret = "correct-horse-battery";

test("CSRF checks reject absent, lookalike and cross-site origins on public/private mutations", async ({ request }) => {
  for (const headers of ([{ origin: "" }, { origin: "https://evil.example" },
    { origin: process.env.E2E_BASE_URL ?? "http://localhost:3000", "sec-fetch-site": "cross-site" }] as Record<string, string>[])) {
    for (const route of ["auth.login", "bookings.create", "telemetry.report"]) {
      expect((await request.post(`${api}/trpc/${route}`, { headers, data: {} })).status()).toBe(403);
    }
  }
});
test("fresh CSP nonces protect production scripts and HTML is never shared", async ({ page, request }) => {
  const first = await request.get("/events"); const second = await request.get("/events");
  const a = first.headers()["content-security-policy"], b = second.headers()["content-security-policy"];
  expect(a).toContain("strict-dynamic"); expect(a).not.toBe(b);
  expect(first.headers()["cache-control"]).toContain("no-store");
  const violations: string[] = [];
  await page.addInitScript(() => {
    (window as unknown as { cspErrors: string[] }).cspErrors = [];
    document.addEventListener("securitypolicyviolation", event => {
      (window as unknown as { cspErrors: string[] }).cspErrors.push(JSON.stringify({ directive: event.violatedDirective, blocked: event.blockedURI, source: event.sourceFile, line: event.lineNumber }));
    });
  });
  await page.goto("/events"); await expect(page.getByLabel("Search title or venue")).toBeVisible();
  await page.getByLabel("Search title or venue").fill("Indie");
  await expect(page.getByRole("status")).toHaveText("1 events loaded");
  violations.push(...await page.evaluate(() => (window as unknown as { cspErrors: string[] }).cspErrors));
  expect(violations).toEqual([]);
  const nonce = await page.locator("script[nonce]").first().evaluate(node => (node as HTMLScriptElement).nonce);
  expect(nonce!.length).toBeGreaterThan(10);
});
test("login rotation, role changes and logout everywhere revoke old devices", async ({ browser, request }) => {
  test.skip(process.env.P10_DEMO !== "1", "role CLI needs disposable local DB");
  const email = `security-${randomUUID()}@example.com`;
  await request.post(`${api}/trpc/auth.signup`, { data: { email, password: secret, confirmPassword: secret } });
  const login = () => request.post(`${api}/trpc/auth.login`, { data: { email, password: secret } });
  const first = await login(); const old = first.headers()["set-cookie"].split(";")[0];
  const second = await login(); const fresh = second.headers()["set-cookie"].split(";")[0]; expect(fresh).not.toBe(old);
  const me = (cookie: string) => request.get(`${api}/trpc/auth.me`, { headers: { cookie } }).then(r => r.json());
  expect((await me(old)).result.data).toBeNull(); expect((await me(fresh)).result.data.email).toBe(email);
  // A separate browser/device receives its own active session.
  const device = await browser.newContext({ baseURL: process.env.E2E_BASE_URL,
    extraHTTPHeaders: { origin: process.env.E2E_BASE_URL! } });
  try {
    await device.request.post(`${api}/trpc/auth.login`, { data: { email, password: secret } });
    execFileSync(process.execPath, ["--import", "tsx", "src/scripts/make-admin.ts", email], { cwd: path.resolve("../api"), stdio: "pipe" });
    expect((await me(fresh)).result.data).toBeNull();
    expect((await (await device.request.get(`${api}/trpc/auth.me`)).json()).result.data).toBeNull();
    await login(); await device.request.post(`${api}/trpc/auth.login`, { data: { email, password: secret } });
    expect((await request.post(`${api}/trpc/auth.logoutEverywhere`, { data: null })).status()).toBe(200);
    expect((await (await device.request.get(`${api}/trpc/auth.me`)).json()).result.data).toBeNull();
  } finally { await device.close(); }
});
test("anonymous web-vitals accepts bounded metrics and rejects private URLs", async ({ page, request }) => {
  const valid = { name: "LCP", value: 123, id: "test-metric", rating: "good", route: "/events" };
  expect((await request.post(`${api}/trpc/telemetry.report`, { data: valid })).status()).toBe(200);
  expect((await request.post(`${api}/trpc/telemetry.report`, { data: { ...valid, route: "/tickets?token=private" } })).status()).toBe(400);
  const metric = page.waitForResponse(response => response.url().includes("telemetry.report") && response.status() === 200);
  await page.goto("/events"); await metric;
});
for (const route of ["/events", "/login", "/signup"]) {
  test(`axe WCAG smoke check ${route}`, async ({ page }) => {
    await page.goto(route); await expect(page.getByRole("main").getByRole("heading", { level: 1 })).toBeVisible();
    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(result.violations).toEqual([]);
  });
}

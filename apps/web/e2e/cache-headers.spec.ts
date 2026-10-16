import { expect, test, type APIResponse, type Response } from "@playwright/test";

// HTTP cache headers (Step 9b): what may be stored by a shared cache (CloudFront), and what never.
//
// 1. Production build or dev server? `next dev` always sends "Cache-Control: no-store" for pages and
//    ignores the headers() rules in next.config.ts, so the EXACT production values can only be
//    checked on a production build (`next build` + `next start`):
//    - in CI, playwright.config.ts starts a production build;
//    - locally, run against your own production build with E2E_PRODUCTION_BUILD=1.
//    Against a dev server these tests still check the privacy rules that hold everywhere
//    (no-store, never public); only the exact /events and "private" checks are skipped.
const productionBuild = process.env.CI === "true" || process.env.E2E_PRODUCTION_BUILD === "1";

// 2. The rules every private answer must follow, on any server: no copy anywhere (no-store), and
//    nothing that invites a shared cache to keep it (public, s-maxage).
function expectNeverShared(cacheControl: string | undefined) {
  expect(cacheControl).toBeDefined();
  expect(cacheControl).toContain("no-store");
  expect(cacheControl).not.toContain("public");
  expect(cacheControl).not.toContain("s-maxage");
}

// 3. A fake session cookie gets past the proxy's "is there a sid cookie?" check, so the page's own
//    HTML comes back (200) instead of the redirect to /login. That HTML is what a cache could store.
async function getWithFakeSession(request: import("@playwright/test").APIRequestContext, path: string): Promise<APIResponse> {
  return request.get(path, { headers: { cookie: "sid=not-a-real-session" }, maxRedirects: 0 });
}

test.describe("private pages are never stored", () => {
  for (const path of ["/dashboard", "/admin/events/new", "/tickets"]) {
    test(`${path} sends private, no-store`, async ({ request }) => {
      const response = await getWithFakeSession(request, path);
      expect(response.status()).toBe(200);
      expectNeverShared(response.headers()["cache-control"]);
      // Without the rule, a production build sends "s-maxage=31536000": these pages are static.
      if (productionBuild) expect(response.headers()["cache-control"]).toBe("private, no-store");
    });
  }

  test("the redirect to /login for a logged-out visitor is private, no-store too", async ({ request }) => {
    test.skip(!productionBuild, "next dev sends no Cache-Control on the proxy's redirect");
    const response = await request.get("/dashboard", { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    expect(response.headers()["cache-control"]).toBe("private, no-store");
  });
});

test.describe("API answers are never stored", () => {
  test("auth.me answers with Cache-Control: no-store", async ({ page }) => {
    // 4. The header's auth.me call, made by the browser after the page loads.
    const authMe = page.waitForResponse((response) => response.url().includes("auth.me"));
    await page.goto("/");
    const response = await authMe;
    expect(response.headers()["cache-control"]).toBe("no-store");
  });

  test("the login answer (with its Set-Cookie) is no-store, never public", async ({ page }) => {
    // 5. A new account through the signup page, then a real login through the login page.
    const email = `cache-headers-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
    const password = "correct-horse-battery";
    await page.goto("/signup");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByLabel("Confirm password").fill(password);
    await page.getByRole("button", { name: "Sign up" }).click();
    await expect(page.getByText("Account created. Login comes next.")).toBeVisible();

    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    const login: Promise<Response> = page.waitForResponse((response) => response.url().includes("auth.login"));
    await page.getByRole("button", { name: "Log in" }).click();
    const response = await login;

    // 6. allHeaders() includes Set-Cookie (headers() leaves it out). The answer DOES set the
    //    session cookie, and it must never be stored by any cache: a stored copy would hand
    //    this session to the next visitor.
    const headers = await response.allHeaders();
    expect(response.status()).toBe(200);
    expect(headers["set-cookie"]).toContain("sid=");
    expect(headers["cache-control"]).toBe("no-store");
    expectNeverShared(headers["cache-control"]);
  });
});

test.describe("/events nonce-bearing HTML stays private", () => {
  test.skip(!productionBuild, "next dev always sends no-store for pages");

  test("the HTML page is private, no-store", async ({ request }) => {
    const response = await request.get("/events?venue=pune&utm_source=newsletter");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("text/html");
    expectNeverShared(response.headers()["cache-control"]);
    // A page a shared cache may store must never set a cookie.
    expect(response.headers()["set-cookie"]).toBeUndefined();
  });

  test("a client-side navigation request (RSC) to the same URL is NOT public", async ({ request }) => {
    // 7. What the Next.js router sends when a <Link> to /events is clicked: the "RSC: 1" header.
    //    Next first answers 307 to add the `_rsc` hash; the request follows it with the same header.
    const response = await request.get("/events", { headers: { rsc: "1", "next-router-prefetch": "1" } });
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("text/x-component");
    expectNeverShared(response.headers()["cache-control"]);
  });
});

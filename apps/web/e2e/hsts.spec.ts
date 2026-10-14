import { expect, test } from "@playwright/test";

// HSTS (Step 11i, apps/web/next.config.ts): sent only by a production build, only when the ALB says
// the visitor came over https (X-Forwarded-Proto), and never for localhost.
//
// 1. Like cache-headers.spec.ts: `next dev` never sends it, so these run against a production build
//    only (CI, or locally with E2E_PRODUCTION_BUILD=1).
//    We fake what the ALB adds with request headers. Host is a made-up name: the rule only looks at
//    the header, the server answers any Host.
const productionBuild = process.env.CI === "true" || process.env.E2E_PRODUCTION_BUILD === "1";

test.describe("Strict-Transport-Security", () => {
  test.skip(!productionBuild, "next dev never sends HSTS");

  const viaAlbHttps = { host: "minitickets.example.com", "x-forwarded-proto": "https" };

  test("sent over https on a real host name, with a 1-day max-age and no preload", async ({ request }) => {
    for (const path of ["/", "/login", "/events"]) {
      const response = await request.get(path, { headers: viaAlbHttps });
      expect(response.headers()["strict-transport-security"], path).toBe("max-age=86400");
    }
  });

  test("not sent over plain http", async ({ request }) => {
    const response = await request.get("/", { headers: { ...viaAlbHttps, "x-forwarded-proto": "http" } });
    expect(response.headers()["strict-transport-security"]).toBeUndefined();
  });

  test("never sent for localhost, even if it says https", async ({ request }) => {
    for (const host of ["localhost:3000", "127.0.0.1:3000", "localhost"]) {
      const response = await request.get("/", { headers: { host, "x-forwarded-proto": "https" } });
      expect(response.headers()["strict-transport-security"], host).toBeUndefined();
    }
    // 2. And not on a normal local request (no X-Forwarded-Proto at all).
    const plain = await request.get("/");
    expect(plain.headers()["strict-transport-security"]).toBeUndefined();
  });
});

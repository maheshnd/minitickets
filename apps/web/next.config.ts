import path from "node:path";
import type { NextConfig } from "next";

// HSTS (HTTP Strict Transport Security, Step 11i): the header
//   Strict-Transport-Security: max-age=86400
// tells the browser "for the next 86400 s (1 day), only ever talk to this host over https". After
// one visit, the browser turns a typed http://… or an old http link into https BEFORE sending
// anything, so nobody on the network (café wifi) can catch that first plain-http request and
// answer it instead of us. The ALB's 301 redirect (infra/src/entry/https-listener.ts) alone cannot
// do that: the plain request has already left the laptop when the redirect comes back.
//
// WHY start short (1 day): HSTS is a promise the browser holds us to. If HTTPS breaks (expired
//   certificate, a wrong DNS record), browsers that saw the header REFUSE the site, with no "continue
//   anyway" button, until max-age runs out. 1 day limits that damage while we learn. Once HTTPS has
//   been stable for a while, raise it step by step (1 week, then 1 year).
// WHY no "includeSubDomains": the header would then also cover *.minitickets.theversehub.in, which
//   we do not run. Nothing to gain.
// WHY no "preload": preload puts the domain on a list built INTO browsers. It needs a 1-year
//   max-age, includeSubDomains, and must be sent by the parent domain (theversehub.in) for ALL its
//   subdomains; and getting off the list again takes months. Far too big a promise for a dev app.
//
// When it is sent, and why each condition:
//   1. production build only (NODE_ENV, read when `next build` runs): `next dev` never sends it.
//   2. the request came over https: the ALB tells us in X-Forwarded-Proto. (Browsers ignore HSTS
//      on plain http anyway, but sending it there would only confuse anyone reading the headers.)
//      In CloudFront mode CloudFront talks http to the ALB, so the web app never sees "https" and
//      sends no HSTS; that would be CloudFront's job (a response headers policy, not built yet).
//   3. never for localhost: HSTS is per host name, for ALL ports. An entry for localhost would
//      force https on every local project in that browser, which plain-http dev servers can't serve.
const hstsRules =
  process.env.NODE_ENV === "production"
    ? [
        {
          source: "/:path*",
          has: [{ type: "header" as const, key: "x-forwarded-proto", value: "https" }],
          missing: [{ type: "host" as const, value: "localhost|127\\.0\\.0\\.1" }],
          headers: [{ key: "Strict-Transport-Security", value: "max-age=86400" }],
        },
      ]
    : [];

const nextConfig: NextConfig = {
  // @concept: monorepo
  // @minitickets/shared ships TypeScript source (no build step), so Next must compile it too.
  transpilePackages: ["@minitickets/shared"],

  // @concept: docker-multi-stage
  // Docker: write .next/standalone, a small self-contained server with only the files the app uses.
  // `next start` still works, so local runs and CI are unchanged.
  output: "standalone",

  // In a monorepo the app imports files from OUTSIDE apps/web (packages/shared, node_modules at the root).
  // File tracing must start at the repo root to find them, or the standalone folder misses files.
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),

  // HTTP cache headers for pages (Step 9b). Measured on a production build of Next 16.4:
  //   - /events (dynamic):              "private, no-cache, no-store, max-age=0, must-revalidate"
  //   - /dashboard, /admin/events/new:  "s-maxage=31536000" (they are STATIC pages: built once,
  //     identical for everyone, so Next tells shared caches "keep it for a year").
  // Next sets its own value only when the response has NO Cache-Control yet, so these rules win
  // in a production build. `next dev` ignores them (it always sends "no-store").
  async headers() {
    return [
      // 1. Private pages: never stored by a shared cache (private) and not by the browser either
      //    (no-store). Their HTML holds no user data today (the profile is fetched in the browser),
      //    but "a private page is never cached" is a rule nobody has to re-check when the page
      //    changes. The rule also covers the proxy's redirect to /login.
      { source: "/dashboard/:path*", headers: [{ key: "Cache-Control", value: "private, no-store" }] },
      { source: "/admin/:path*", headers: [{ key: "Cache-Control", value: "private, no-store" }] },

      // 2. /events, the full HTML page only. The same for every visitor, so CloudFront may share it
      //    (docs: infra/src/entry/cdn.ts, the /events behavior):
      //    - public:                     a shared cache may store it;
      //    - max-age=0:                  the BROWSER keeps no fresh copy (asks again every time);
      //    - s-maxage=30:                a SHARED cache (CloudFront) keeps it 30 s;
      //    - stale-while-revalidate=300: after that, for up to 5 more minutes, it may still hand out
      //                                  the old copy while it fetches a new one in the background.
      //    `missing: rsc` = NOT for Next's client navigation requests (header "RSC: 1"). Those get
      //    the RSC payload, not HTML, and keep Next's own "private, no-store": the payload depends
      //    on the page the visitor comes from (Next-Router-State-Tree), so it is never shared.
      {
        source: "/events",
        missing: [{ type: "header", key: "rsc" }],
        headers: [{ key: "Cache-Control", value: "public, max-age=0, s-maxage=30, stale-while-revalidate=300" }],
      },

      // 3. HSTS on every path, only in production over https (see hstsRules at the top).
      ...hstsRules,
    ];
  },
};

export default nextConfig;

import path from "node:path";
import type { NextConfig } from "next";

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
    ];
  },
};

export default nextConfig;

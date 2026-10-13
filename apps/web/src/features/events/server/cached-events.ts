import type { ListEventsInput } from "@minitickets/shared";
import { revalidateTag, unstable_cache } from "next/cache";
import { makeServerTrpcClient } from "@/lib/trpc/server";

// The web server's own cache of events.list answers: the Next.js DATA CACHE.
//
// WHICH API (Next.js 16.4, the installed version) AND WHY:
//   unstable_cache(fn, keyParts, { tags, revalidate }). Next 16's docs list it as THE way to cache
//   a non-fetch function in an app WITHOUT "Cache Components" (guide "Caching (Previous Model)"),
//   and say it keeps working after Cache Components is turned on.
//   - Not "use cache" + cacheLife + cacheTag (Next 16's new API): it only works with the
//     cacheComponents flag, which changes how EVERY route renders (no `dynamic` exports, request
//     data only inside <Suspense>, `new Date()` in the root layout's footer fails the build...).
//     That is a step of its own, not a side effect of caching one list.
//   - Not fetch(url, { next: { revalidate, tags } }): the tRPC client makes the fetch, the URL holds
//     the RAW input (not the canonical one), and the page's `dynamic = "force-dynamic"` turns
//     every fetch's cache off anyway.
//
// STACKED CACHES: this is a cache ON TOP of the API's Redis cache, which is on top of Postgres.
//   browser (React Query, 30 s staleTime) -> THIS (web server, 30 s) -> API Redis (soft 30-33 s,
//   hard 5 min) -> Postgres. Each layer can hand out a copy that was ALREADY old when it got it, so
//   their staleness ADDS UP: a list can be 30 s old in Redis when this cache stores it, and then
//   kept here 30 s more. A new EVENT is the exception: the API fixes Redis at once (generation
//   bump) and then calls our revalidate hook (app/api/revalidate/route.ts), which empties this cache.
//   Measured (local, production build, one visit per second):
//   - new event, hook on: in the server HTML after 8-68 ms;
//   - new event, hook off: after ~30 s (30.2 s and 30.7 s);
//   - a change NOTHING invalidates (row edited in Postgres): 90.6 s, not 30 + 30. Both layers use
//     stale-while-revalidate, so this cache's background refresh at ~60 s got Redis's STALE copy
//     and kept the old list another 30 s. Each refresh can pull an old copy from the layer below.
//     The browser's 30 s staleTime can add 30 s more on client-side navigation (not on a reload).

// 1. The tag on every cached list. revalidateEventsCache() below empties all of them at once,
//    whatever filters they were for (like the API's ONE generation bump for every filter key).
const EVENTS_TAG = "events";

// 2. The cached fetch. Called with the CANONICAL input (../lib/canonical-input.ts).
//    - THE KEY: unstable_cache builds it from keyParts ("events.list"), the function's source, and
//      JSON.stringify of the arguments. So the canonical input IS part of the key: "Pune" and
//      " pune " share one entry, Pune and Mumbai never do.
//    - revalidate: 30 = a LIFETIME of 30 s, but a soft one (stale-while-revalidate): the first
//      request after 30 s still gets the old copy, and Next refreshes it in the background for the
//      next visitor. So on a page nobody opened for a while, ONE visitor can get a copy older than
//      30 s. There is no hard limit option here (that is cacheLife's `expire`, Cache Components only).
//    - Only SUCCESSFUL answers are stored: if the API call throws, nothing is cached and the error
//      goes to prefetchEvents (which logs it; the browser then fetches the list itself). If a
//      BACKGROUND refresh fails, Next logs it and keeps serving the old copy.
//    - The cache lives in this web server process (memory, plus .next/cache on its disk). A second
//      web server has its own, and the revalidate hook reaches only the one it was sent to.
//    - The console line runs only when the function runs, i.e. on a MISS (or a refresh): that is
//      how the web server's log tells a hit (no line, and no request in the API log) from a miss.
export const getCachedEvents = unstable_cache(
  async (canonicalInput: ListEventsInput) => {
    console.info(`next data cache miss: events.list ${JSON.stringify(canonicalInput)}`);
    return makeServerTrpcClient().events.list.query(canonicalInput);
  },
  ["events.list"],
  { tags: [EVENTS_TAG], revalidate: 30 },
);

// 3. Empty every cached events list, NOW. Called by the revalidate hook after an event is created.
//    { expire: 0 } = "expired right away": the next request waits for a fresh list from the API.
//    NOT "max" (what the docs recommend for most cases): "max" only marks the lists STALE, so the
//    next visitor still gets the OLD list once while Next refreshes in the background; the admin's
//    reload would not show the new event. Next's docs name { expire: 0 } for exactly this case:
//    an invalidation that comes from ANOTHER service through a Route Handler (updateTag, the
//    "expire now" function, only works inside Server Actions).
export function revalidateEventsCache(): void {
  revalidateTag(EVENTS_TAG, { expire: 0 });
}

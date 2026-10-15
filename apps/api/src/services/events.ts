import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  ListEventsOutput,
  type CreateEventInput,
  type Event as PublicEvent,
  type ListEventsInput,
} from "@minitickets/shared";
import { env } from "../config/env";
import { NotFoundError } from "../errors";
import * as eventsCache from "../queries/events-cache";
import * as events from "../queries/events";
import * as webCache from "../queries/web-cache";
import { canonicalFilters, canonicalString, type EventFilters } from "./event-filters";
import { singleFlight } from "./single-flight";
import { signAssetGet } from "../queries/assets";

// Services: business logic. No HTTP and no SQL in here.

// @concept: cache-aside
// @concept: ttl
// 1. The cached list has TWO ages that matter (both from env, so a demo can shorten them):
//    - SOFT TTL (default 30 s, plus 0-10% jitter, see step 1a): younger than this, the list is
//      FRESH and served as it is.
//    - HARD TTL (default 5 min): the key's expiry in Redis. Between soft and hard the list is STALE:
//      it is still served, at once, while a background refresh replaces it ("stale-while-revalidate",
//      step 12). Older than the hard TTL it is never served, not even when Postgres is down (step 12a).
//    Staleness: creating an event or booking a ticket makes the list correct at once
//    (invalidateEventLists below). Other changes (e.g. a row edited by hand in psql) do not: a busy
//    list is refreshed about every soft TTL, but a list nobody asked for in a while can be served
//    ONCE at up to the hard TTL old, while it refreshes.
//    That is fine for BROWSING. Booking always checks the database (a locked row, never this
//    cache), so a stale list can never cause overselling.
const SOFT_TTL_MS = env.EVENTS_CACHE_SOFT_TTL_MS;
const HARD_TTL_MS = env.EVENTS_CACHE_HARD_TTL_MS;

// 1a. JITTER on the SOFT TTL: each cached list gets its own soft TTL, a random 0-10% longer
//     (30 s -> somewhere between 30 and 33 s). It is picked when the list is WRITTEN and stored
//     with it (`staleAt`), so every reader agrees on when that copy turns stale.
//     WHY NOW: since Step 8 there is one key PER FILTER. Right after an event is created, the
//     generation is new and every filter's key is empty; a busy minute refills, say, 200 filter keys
//     within a second or two. Without jitter, all 200 turn stale in the same second 30 s later, and
//     their 200 background refreshes hit Postgres together, again every 30 s (a "synchronized
//     refresh"). Jitter spreads them over 3 s.
//     WHY NOT IN STEP 7: there was only ONE key. One key can only ever cause one refresh at a time
//     (single-flight + the Redis lock), so there was nothing to spread.
//     WHY THE SOFT TTL AND NOT THE HARD ONE: refreshes happen at the soft TTL (busy keys never reach
//     the hard one), and the hard TTL stays an EXACT limit on age, which jitter would blur.
const SOFT_TTL_JITTER = 0.1;

// 1b. KEY EXPLOSION: one key per filter means the number of keys depends on what people ASK for,
//     not on how many events we have. These keep it bounded:
//     - canonical filters (./event-filters.ts): " Pune", "pune" and "PUNE" are one key, not three;
//     - dates rounded to whole UTC days: one key per day, not one per millisecond;
//     - the range limit (at most 1 year, in the shared ListEventsInput): one "from" day can pair
//       with at most 366 "to" days;
//     - the HARD TTL: a key nobody reads disappears after 5 minutes, so only filters asked for in
//       the last 5 minutes take memory;
//     - the generation: after a bump, all old keys are dead weight that the hard TTL removes;
//     - the Redis EVICTION POLICY (docker-compose.yml: allkeys-lru): if memory still fills up,
//       Redis deletes the least recently used keys instead of refusing writes.
//     The venue is free text, so it is NOT bounded by the above: someone could ask for a million
//     made-up venues. Each costs one small key for 5 minutes (and one Postgres query); rate
//     limiting would be the real fix (not built).
//     IF RESPONSES DEPENDED ON THE VIEWER (a price in their currency, a "your bookings" list, a
//     language), the user / currency / locale would HAVE to be part of the canonical filters (so
//     the key). Otherwise the first viewer's answer would be served to everyone. Today events.list is
//     the same for every visitor, so the key holds only the filters.

// 2. The rebuild lock in Redis (see step 8 below), shared by ALL API instances.
//    - LOCK_TTL_MS: the lock deletes itself after 5 seconds, even if its holder crashed. A rebuild
//      normally takes a few milliseconds, so 5 s is plenty and a crash blocks nobody for long.
//    - Instances that do not get the lock re-check the cache up to 5 times, 50 ms apart
//      (at most ~250 ms), then give up waiting and read Postgres themselves.
//    The lock's LIMITS: if a rebuild takes longer than 5 s, the lock expires and a second instance
//    may rebuild too; if Redis restarts, the lock is simply gone. Both only mean "an extra
//    Postgres query", which is harmless here: every rebuild writes the same correct list.
//    That is why this lock is fine for a CACHE but must never guard SEATS: there "two holders at
//    once" would mean selling the same seat twice. Seats need the database's own guarantees.
const LOCK_TTL_MS = 5000;
const LOCK_WAIT_ATTEMPTS = 5;
const LOCK_WAIT_DELAY_MS = 50;

// 3. What we store in Redis: the list, when it was read from Postgres (ms since 1970), and when it
//    turns stale (fetchedAt + its jittered soft TTL, step 1a).
//    `staleAt` tells fresh from stale; `fetchedAt` is checked against the hard TTL. Redis's own TTL
//    only says "still there or gone". Checked with Zod on every read (step 14), like the list itself.
const CachedUpcoming = z.object({
  data: ListEventsOutput,
  fetchedAt: z.number().int().nonnegative(),
  staleAt: z.number().int().nonnegative(),
});
type CachedUpcoming = z.infer<typeof CachedUpcoming>;

// Only what we need from a logger, so this file does not depend on Fastify and tests can pass a fake.
export type Log = {
  error: (obj: object, msg: string) => void;
  warn: (obj: object, msg: string) => void;
  info: (msg: string) => void;
  debug: (msg: string) => void;
};

// The answer plus how we got it, for the request log:
//   "fresh"          from Redis, younger than its soft TTL;
//   "stale"          from Redis, older than its soft TTL: served now, refreshed in the background;
//   "stale-if-error" like "stale", but the last background refresh failed (Postgres down): we are
//                    serving old data BECAUSE of an error, not just while a refresh runs;
//   "miss"           nothing in Redis: rebuilt from Postgres (or waited for another instance's rebuild);
//   "error"          Redis down or slow: read Postgres directly.
export type CacheStatus = "fresh" | "stale" | "stale-if-error" | "miss" | "error";

// 4. Did the last background refresh in THIS process fail? Only used to label stale answers
//    "stale-if-error" (see CacheStatus). It lives in this process's memory, like single-flight:
//    another instance finds out on its own first refresh.
//    One flag for ALL filters (not one per key): every filter's refresh asks the same Postgres, so
//    one failed refresh says "Postgres is in trouble" for all of them, and any refresh that works
//    clears it. (A flag per key would also have to be cleaned up for keys nobody reads any more.)
let lastRefreshFailed = false;

// Upcoming events for the public list, optionally filtered by venue and dates.
export async function listUpcomingEvents(input: ListEventsInput | undefined, log: Log, now: Date = new Date()) {
  // 4b. The CANONICAL filters (./event-filters.ts): ONE form for the Postgres query, the cache key,
  //     the single-flight key and the lock key. So " Pune", "pune" and "PUNE" are the same question
  //     everywhere: one cache entry, one rebuild, one lock.
  const filters = canonicalFilters(input);
  const canonical = canonicalString(filters);

  // @concept: graceful-degradation
  // 5. Ask the cache first. Redis is only a speed-up, so it must never be able to fail the request:
  //    an error or a timeout is caught, logged as a warning, and we carry on with Postgres.
  //    a. Read the current GENERATION first (a number that goes up whenever the list changes).
  //       It must come BEFORE the list and before any Postgres read: createEvent explains why.
  //    b. Build this filter's key in that generation and read it. Everything below (cache write,
  //       lock, refresh) uses the same `key`. The key ends in a HASH of the filters, which nobody
  //       can read, so the debug line shows the canonical text next to it.
  //    WHY INVALIDATION BEATS SWR: after an event is created, the generation is new and its key is
  //    EMPTY, so the next read is a MISS (step 6), never the stale list from before the change.
  //    Invalidation means "this data must not be served any more"; SWR and stale-if-error only ever
  //    serve a copy of the CURRENT generation, so they can never bring the old list back.
  let cacheStatus: CacheStatus = "miss";
  let key = "";
  try {
    const gen = await eventsCache.getUpcomingGeneration();
    key = eventsCache.upcomingKey(gen, canonical);
    log.debug(`events cache key ${key} = ${canonical}`);
    const cached = await readCache(log, key);
    if (cached !== null) {
      // c. FRESH: serve it, nothing else to do.
      if (now.getTime() < cached.staleAt) return { events: cached.data, cache: "fresh" as CacheStatus };

      // d. STALE: serve it NOW, and start a refresh that this request does NOT wait for.
      //    The visitor gets cache speed; the next visitors get the refreshed list.
      if (now.getTime() - cached.fetchedAt < HARD_TTL_MS) {
        refreshInBackground(log, now, key, filters);
        const status: CacheStatus = lastRefreshFailed ? "stale-if-error" : "stale";
        return { events: cached.data, cache: status };
      }

      // e. Older than the hard TTL. Redis normally deletes it before that, but the clocks of two
      //    instances can differ a little, and the key's expiry starts a moment after fetchedAt.
      //    We treat it as missing, so the hard TTL is an exact limit.
    }
  } catch (err) {
    cacheStatus = "error";
    log.warn({ err }, "events cache read failed, falling back to Postgres");
  }

  // 6. Cache MISS (or error): rebuild the list, but only ONCE per process at a time.
  //    If 100 requests miss together, the first starts the rebuild and the other 99 wait for that
  //    same rebuild (single-flight, see ./single-flight.ts). This protects Postgres from a "cache
  //    stampede". It even helps while Redis is down: Postgres still gets one query, not 100.
  //    The waiters share the first request's `now`: it is only milliseconds older than theirs.
  //    The single-flight key IS the cache key, so it has the generation and the canonical filters:
  //    - " Pune" and "PUNE" join ONE rebuild; "pune" and "mumbai" never join each other's;
  //    - a request that saw the NEW generation never joins a rebuild that started before the event
  //      was created: that rebuild may have read Postgres before the insert (the old list).
  //    If Postgres fails here, the request fails as before: a miss has no copy of this generation
  //    to fall back to (that is what "miss" means), and an older generation must never be used.
  const flightKey = cacheStatus === "error" ? `${NO_CACHE_FLIGHT_KEY}:${canonical}` : key;
  const list = await singleFlight(flightKey, () => rebuild(log, now, cacheStatus, key, filters));
  return { events: list, cache: cacheStatus };
}

// The single-flight key's start while Redis is down (no generation, so no cache key). Only this
// process uses it (it is not a Redis key).
const NO_CACHE_FLIGHT_KEY = "events:upcoming:no-cache";

// Rebuild the list under `key` after a miss. Runs once per process at a time (step 6). The
// Redis lock below makes it (normally) once across ALL processes.
async function rebuild(
  log: Log,
  now: Date,
  cacheStatus: CacheStatus,
  key: string,
  filters: EventFilters,
): Promise<PublicEvent[]> {
  // 7. Redis already failed for this request: no lock, no cache write, just Postgres.
  //    Waiting for a lock in a broken Redis would only slow the visitor down.
  if (cacheStatus === "error") return readPostgres(log, now, filters);

  // 8. Single-flight cannot see other API instances: each one would still send its own query.
  //    So we also take a lock in Redis, which every instance shares. A random token marks the lock
  //    as OURS, so we never release a lock that has expired and been taken by someone else.
  const token = randomUUID();
  let gotLock: boolean;
  try {
    gotLock = await eventsCache.tryLockUpcomingRebuild(key, token, LOCK_TTL_MS);
  } catch (err) {
    // Redis broke between the read and now: same as step 7.
    log.warn({ err }, "events cache lock failed, falling back to Postgres");
    return readPostgres(log, now, filters);
  }

  // 9. We hold the lock: we are the one instance that queries Postgres and fills the cache.
  if (gotLock) return rebuildAsLockHolder(log, now, key, filters, token);

  // 10. Another instance holds the lock and is rebuilding. Wait for its result in the cache.
  const fromCache = await waitForCache(log, now, key);
  if (fromCache !== null) return fromCache;

  // 11. Still nothing after ~250 ms: the holder is slow or has crashed. Read Postgres ourselves.
  //    TRADE-OFF: the visitor never waits more than ~250 ms extra, at the price of an extra
  //    Postgres query in that rare case. (Waiting longer would protect Postgres more but make
  //    visitors wait; never falling back would make one dead holder break the page.)
  log.warn({ attempts: LOCK_WAIT_ATTEMPTS }, "events cache still empty after waiting for the lock holder, reading Postgres");
  const list = await readPostgres(log, now, filters);
  await writeCache(log, key, list, now);
  return list;
}

// 9a. The lock holder's work, shared by a miss (rebuild) and a background refresh (refresh).
//     The cache is written BEFORE the lock is released, so waiters find it on their next check.
//     `finally` releases the lock on success AND on error (else others wait until it expires).
async function rebuildAsLockHolder(
  log: Log,
  now: Date,
  key: string,
  filters: EventFilters,
  token: string,
): Promise<PublicEvent[]> {
  try {
    // Look at the cache ONE more time first ("double-check"). Another instance may have taken the
    // lock, filled the cache and released the lock in the short gap between our cache read and our
    // lock. Then the lock was free, but the work is done. Without this check we measured
    // 2 Postgres queries (not 1) in 2 of 5 two-instance runs.
    // Only a FRESH copy counts as done: a refresh starts BECAUSE the copy is stale.
    const alreadyFresh = await recheckCache(log, now, key);
    if (alreadyFresh !== null) return alreadyFresh;

    const list = await readPostgres(log, now, filters);
    await writeCache(log, key, list, now);
    return list;
  } finally {
    await releaseLock(log, key, token);
  }
}

// 12. STALE-WHILE-REVALIDATE: refresh a stale list without making anyone wait for it.
//     FIRE-AND-FORGET: we start the refresh and do not await it. That is safe HERE because:
//     - nobody needs its result: the visitor already has the stale list, and the refresh only
//       writes the cache for the visitors after them;
//     - its errors are caught right below, so it can never crash the process or become an
//       "unhandled rejection" (which Node would report, and by default stop the process for);
//     - if it never finishes, nothing breaks: the stale copy is still served and the next stale
//       read tries again.
//     Its LIMITS: it lives only in this process's memory. If the process exits mid-refresh (deploy,
//     crash), the refresh is simply lost, and nothing retries it except the next stale read.
//     So this pattern is only for work that is allowed to be lost. Work that MUST happen (sending a
//     ticket email) needs a real job queue.
//     ONE refresh even when many visitors see the stale copy at once: single-flight (same process)
//     and the Redis lock (all instances) from the miss path are reused.
function refreshInBackground(log: Log, now: Date, key: string, filters: EventFilters): void {
  // `void` says "we do not await this on purpose". The catch is INSIDE the single-flight work, so
  // it runs once per refresh (not once per visitor who joined), and the promise never rejects.
  void singleFlight(`${key}:refresh`, () =>
    refresh(log, now, key, filters).catch((err: unknown) => {
      // 12a. STALE-IF-ERROR: Postgres failed, so we keep serving the stale copy (it stays in Redis,
      //      untouched) and only log a warning. Later stale answers are labelled "stale-if-error".
      //      TRADE-OFF: AVAILABILITY over FRESHNESS. Visitors get an old list instead of an error page.
      //      The HARD TTL caps how old that list can get: after it, Redis has deleted the copy, the
      //      next read is a miss, and a miss with Postgres down returns the error (step 6).
      lastRefreshFailed = true;
      log.warn(
        { err, cache: "stale-if-error", hardTtlMs: HARD_TTL_MS },
        "events cache background refresh failed: still serving the stale list (stale-if-error)",
      );
    }),
  );
}

// 13. The background refresh itself. It takes the same Redis lock as a miss, but it never waits:
//     if another instance holds the lock, that instance is already refreshing (or rebuilding),
//     and the stale copy is fine to serve until it is done.
async function refresh(log: Log, now: Date, key: string, filters: EventFilters): Promise<void> {
  const token = randomUUID();
  let gotLock: boolean;
  try {
    gotLock = await eventsCache.tryLockUpcomingRebuild(key, token, LOCK_TTL_MS);
  } catch (err) {
    // Redis broke: we could not write the result anyway, so there is nothing useful to do.
    log.warn({ err }, "events cache lock failed, skipping the background refresh");
    return;
  }
  if (!gotLock) return;

  // Throws if Postgres fails: refreshInBackground catches it (stale-if-error).
  await rebuildAsLockHolder(log, now, key, filters, token);
  lastRefreshFailed = false;
  log.debug(`events cache background refresh done (${key})`);
}

// Re-check the cache a few times, a short pause before each check. Returns the list as soon as
// a fresh one is there, or null if it never shows up (or Redis fails while we wait).
async function waitForCache(log: Log, now: Date, key: string): Promise<PublicEvent[] | null> {
  for (let attempt = 1; attempt <= LOCK_WAIT_ATTEMPTS; attempt++) {
    await sleep(LOCK_WAIT_DELAY_MS);
    try {
      const fresh = freshList(await readCache(log, key), now);
      if (fresh !== null) return fresh;
    } catch (err) {
      log.warn({ err }, "events cache read failed while waiting for the lock holder");
      return null;
    }
  }
  return null;
}

// One cache read for the double-check (step 9a). Any problem (Redis error, bad value, only a stale
// copy) just means "not done yet": the lock holder then reads Postgres as planned.
async function recheckCache(log: Log, now: Date, key: string): Promise<PublicEvent[] | null> {
  try {
    return freshList(await readCache(log, key), now);
  } catch (err) {
    log.warn({ err }, "events cache re-check failed, reading Postgres");
    return null;
  }
}

// The list if the cached value is fresh (before its staleAt), else null.
function freshList(cached: CachedUpcoming | null, now: Date): PublicEvent[] | null {
  if (cached === null) return null;
  return now.getTime() < cached.staleAt ? cached.data : null;
}

// Release our lock. A failure is only logged: the lock deletes itself after LOCK_TTL_MS anyway.
async function releaseLock(log: Log, key: string, token: string) {
  try {
    const released = await eventsCache.releaseUpcomingRebuildLock(key, token);
    if (!released) log.warn({ lockTtlMs: LOCK_TTL_MS }, "events cache lock had expired before release (rebuild too slow?)");
  } catch (err) {
    log.warn({ err }, "events cache lock release failed");
  }
}

// Read Postgres and pick the public fields.
async function readPostgres(log: Log, now: Date, filters: EventFilters): Promise<PublicEvent[]> {
  // "Upcoming" means "starts after right now". The clock is a parameter only so tests can set it.
  const rows = await events.listUpcoming(now, filters, log);
  return rows.map(toPublicEvent);
}

// Pick the public fields by hand. startsAt becomes an ISO string (JSON has no Date type),
// which is also exactly what we store in Redis.
type EventRow = { id: string; title: string; venue: string; startsAt: Date; totalSeats: number; seatsLeft: number };
function toPublicEvent(row: EventRow): PublicEvent {
  return {
    id: row.id,
    title: row.title,
    venue: row.venue,
    startsAt: row.startsAt.toISOString(),
    totalSeats: row.totalSeats,
    seatsLeft: row.seatsLeft,
  };
}

// Fill the cache under `key` for the next visitors. `fetchedAt` is the time we asked Postgres (a
// moment before the answer, so the age is never under-counted). `staleAt` adds the soft TTL plus
// this copy's random jitter (step 1a), but never past the hard TTL (with a soft TTL set within 10%
// of the hard one, jitter could otherwise keep a copy "fresh" after the hard limit).
// Redis deletes the key after the HARD TTL.
// A failed write is logged and ignored: the visitor already has their answer.
async function writeCache(log: Log, key: string, list: PublicEvent[], fetchedAt: Date) {
  const jitterMs = Math.floor(Math.random() * SOFT_TTL_MS * SOFT_TTL_JITTER);
  const value: CachedUpcoming = {
    data: list,
    fetchedAt: fetchedAt.getTime(),
    staleAt: Math.min(fetchedAt.getTime() + SOFT_TTL_MS + jitterMs, fetchedAt.getTime() + HARD_TTL_MS),
  };
  try {
    await eventsCache.setUpcomingInCache(key, JSON.stringify(value), HARD_TTL_MS);
  } catch (err) {
    log.warn({ err }, "events cache write failed");
  }
}

// Read and check the cached value under `key`. null = nothing there, or a bad value.
// Throws when Redis is down or too slow (the callers decide what that means).
async function readCache(log: Log, key: string): Promise<CachedUpcoming | null> {
  const text = await eventsCache.getUpcomingFromCache(key);
  return text === null ? null : parseCached(text, log);
}

// 14. Check cached text before trusting it. It could be cut off, or written by older code with a
//     different shape. The list part is checked with the SAME Zod schema the procedure uses for its
//     output, so a bad value can never reach a visitor. A bad value counts as a miss (null): the
//     rebuild overwrites it, so it fixes itself.
function parseCached(text: string, log: Log): CachedUpcoming | null {
  const parsed = CachedUpcoming.safeParse(parseJson(text));
  if (parsed.success) return parsed.data;
  log.warn({ issues: parsed.error.issues.length }, "events cache value is invalid, treating as a miss");
  return null;
}

// JSON.parse throws on broken text. Returning undefined instead makes the Zod check fail,
// so "cut-off text" and "wrong shape" end up on the same path: a warning and a miss.
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

// Wait `ms` milliseconds.
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Create an event (admins only; adminProcedure checked the role before we get here).
export async function createEvent(input: CreateEventInput, log: Log): Promise<PublicEvent> {
  // 15. Save it. A new event starts with every seat free, so seatsLeft = totalSeats. The browser
  //     sends startsAt as ISO text; Postgres wants a Date.
  //     When this line returns, the insert is COMMITTED (see queries/events.ts, `create`).
  const row = await events.create({
    title: input.title,
    venue: input.venue,
    startsAt: new Date(input.startsAt),
    totalSeats: input.totalSeats,
    seatsLeft: input.totalSeats,
  });

  // 16. Invalidate the cached lists, so the very next events.list shows the new event.
  //     If the insert above failed, it threw and we never get here: nothing changed, so there is
  //     nothing to invalidate.
  await invalidateEventLists(log);

  return toPublicEvent(row);
}

// One event by id, for the event page. Straight from Postgres, no cache (see queries/events.ts,
// findById): the page shows seats left next to the "Book ticket" button.
export async function getEvent(id: string): Promise<PublicEvent> {
  const row = await events.findById(id);
  if (!row) throw new NotFoundError("Event not found");
  // 18. Only the uncached detail response carries an expiring poster link; list caches keep
  //     plain event data. No public bucket, hardcoded S3 hostname or permanent signed URL.
  //     The public route must NEVER turn a corrupt poster key into a private ticket link.
  if (row.posterKey && !row.posterKey.startsWith(`posters/${row.id}/`)) throw new Error("invalid published poster key");
  return { ...toPublicEvent(row), posterUrl: row.posterKey ? await signAssetGet(row.posterKey) : null };
}

// Invalidate every cached events list, after anything that changes them: a new event (createEvent
// above) or seats taken by a booking (services/bookings.ts). Never throws: both steps only log.
// 17. Our cache first (Redis, a new generation: invalidateUpcomingList), then the cache ABOVE ours:
//     the web server's Next.js data cache (30 s, revalidateWebCache). In this order: bottom-up.
export async function invalidateEventLists(log: Log): Promise<void> {
  await invalidateUpcomingList(log);
  revalidateWebCache(log);
}

// Tell the web app to drop its cached events lists (POST /api/revalidate, queries/web-cache.ts).
//
// STACKED CACHES: a server-rendered /events reads Next.js's data cache (web, 30 s), which on a miss
// asks the API, which reads Redis, which on a miss reads Postgres. The INCR above only fixed Redis.
// Without this call, the web server could keep showing the old list for up to 30 s more.
//
// WHY AFTER THE INCR (bottom-up, the same rule as "write, then invalidate"):
//   If the web cache were dropped FIRST, the next page view could ask the API before the INCR and
//   get the OLD list from Redis, and the web cache would then keep that old list for another 30 s.
//   Invalidate the cache nearest the data first, then each cache above it, in order.
//   It runs even when the INCR failed: usually that means Redis is down, and then the API reads
//   Postgres directly (step 5), so the web cache refills with the NEW list.
//
// WHY FIRE-AND-FORGET (started, never awaited):
//   The event IS saved and Redis IS fixed: the admin's request is done. Waiting would make every
//   create as slow as the web server (up to the 1 s timeout when it hangs), and failing the request
//   would be wrong (the admin might create the event twice). So we start the call and return.
//   If it fails (web down, timeout, wrong secret), we log a WARNING and nothing else: the web
//   cache's 30 s lifetime is the safety net that bounds the staleness. No retries, for the same
//   reason: the timer fixes it anyway, and a retry loop is more code than the gain.
//   TRADE-OFF: the call is in flight for a few ms after the admin's answer, so a page view in that
//   window can still get the old list. And like the background refresh (step 12), it lives only in
//   this process: if the API stops right now, the call is lost (the 30 s still applies).
//   The .catch is right here, so the promise can never become an "unhandled rejection".
function revalidateWebCache(log: Log): void {
  void webCache
    .revalidateEventsPages()
    .then((sent) => {
      if (sent) log.debug("web cache revalidated: tag events");
    })
    .catch((err: unknown) => {
      log.warn({ err }, "web cache revalidate failed: /events on the web server may be stale for up to 30 s");
    });
}

// Make every reader use a new, empty cache key ("start a new generation").
//
// WHY AFTER THE COMMIT (write first, then invalidate):
//   If we bumped the generation BEFORE the insert was committed, a reader could see the new
//   generation, miss, read Postgres while the new row is still invisible, and store the OLD list
//   under the NEW generation. Everyone would then get the old list until the TTL ran out.
//   Bumping AFTER the commit, together with readers reading the generation BEFORE Postgres, makes
//   that impossible: a reader that sees the new number started after the commit, so its Postgres
//   read includes the new row.
//
// WHY INCR (a new key) INSTEAD OF DEL (empty the same key):
//   The "stale refill" race. A slow reader can read Postgres BEFORE the insert and write its result
//   AFTER our invalidation:
//     reader: miss, reads Postgres (old list) ........................ writes the old list late
//     writer:                        insert + commit, invalidate
//   With DEL, that late write lands in the ONE key everybody reads, so the old list is back for a
//   whole TTL, and our invalidation was for nothing. With a generation, the slow reader read the
//   generation at its start (the OLD number), so it writes to the OLD key. Nobody reads that key
//   any more, and Redis deletes it when its TTL runs out. (A background refresh of the old
//   generation that is still running is the same: it can only write the old key.)
//
// WITH FILTERS (Step 8) THE GENERATION IS EVEN MORE USEFUL:
//   A new event can change MANY filtered lists ("no filter", its venue, every date range that
//   contains it). Every filter's key contains the generation, so this ONE INCR invalidates all of
//   them at once, in one atomic step that costs the same for 1 key or 10,000. Deleting them one by
//   one instead would mean: finding them first (we do not even know which filters people asked for;
//   SCAN walks EVERY key in Redis, slowly), deleting each (not atomic: a reader can refill one we
//   already deleted, the stale-refill race once per key), and missing keys written during the scan.
//
// IF REDIS IS DOWN (the INCR fails):
//   The event IS saved, so the request still succeeds; we only log an error. Readers keep using
//   the old generation. Its copy stays fresh for up to one soft TTL (~30 s); after that the next
//   read is "stale" and its background refresh picks up the new event. That is "bounded
//   staleness". Failing the request instead would be worse: the admin would see an error for an
//   event that was in fact created, and might create it a second time.
async function invalidateUpcomingList(log: Log) {
  try {
    const gen = await eventsCache.bumpUpcomingGeneration();
    log.debug(`events cache invalidated: generation is now ${gen}`);
  } catch (err) {
    log.error({ err }, "events cache invalidation failed: the list may be stale until its next refresh (one soft TTL, ~30 s)");
  }
}

import { randomUUID } from "node:crypto";
import { ListEventsOutput, type CreateEventInput, type Event as PublicEvent } from "@minitickets/shared";
import * as eventsCache from "../queries/events-cache";
import * as events from "../queries/events";
import { singleFlight } from "./single-flight";

// Services: business logic. No HTTP and no SQL in here.

// @concept: cache-aside
// @concept: ttl
// 1. How long a cached list may live: 30 seconds, plus 0 to 3 random seconds (jitter).
//    Jitter: if many keys were all written at the same moment with the same TTL, they would all
//    expire at the same moment and send a burst of reads to Postgres. A few random seconds
//    spread that out. (We have one key today, so this is a habit for when there are more.)
//    Staleness: creating an event makes the list fresh at once (createEvent below). Other changes
//    (e.g. `seatsLeft` going down, later) do not, so the list can still be up to about 33 seconds
//    old. That is fine for BROWSING. Booking will always check the database, never this cache,
//    so a stale list can never cause overselling.
const BASE_TTL_SECONDS = 30;
const MAX_JITTER_SECONDS = 3;

// 2. The rebuild lock in Redis (see step 6 below), shared by ALL API instances.
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

// Only what we need from a logger, so this file does not depend on Fastify and tests can pass a fake.
export type Log = {
  error: (obj: object, msg: string) => void;
  warn: (obj: object, msg: string) => void;
  debug: (msg: string) => void;
};

// The answer plus how we got it, for the request log: "hit" (from Redis), "miss" (rebuilt, or
// waited for another rebuild), "error" (Redis down or slow, read Postgres).
export type CacheStatus = "hit" | "miss" | "error";

// Upcoming events for the public list.
export async function listUpcomingEvents(log: Log, now: Date = new Date()) {
  // @concept: graceful-degradation
  // 3. Ask the cache first. Redis is only a speed-up, so it must never be able to fail the request:
  //    an error or a timeout is caught, logged as a warning, and we carry on with Postgres.
  //    a. Read the current GENERATION first (a number that goes up whenever the list changes).
  //       It must come BEFORE the list and before any Postgres read: createEvent explains why.
  //    b. Then read that generation's key. Everything below (cache write, lock) uses the same `gen`.
  let cacheStatus: CacheStatus = "miss";
  let gen = 0;
  try {
    gen = await eventsCache.getUpcomingGeneration();
    const cached = await eventsCache.getUpcomingFromCache(gen);
    const list = cached === null ? null : parseCached(cached, log);
    if (list !== null) return { events: list, cache: "hit" as CacheStatus };
  } catch (err) {
    cacheStatus = "error";
    log.warn({ err }, "events cache read failed, falling back to Postgres");
  }

  // 4. Cache MISS (or error): rebuild the list, but only ONCE per process at a time.
  //    If 100 requests miss together, the first starts the rebuild and the other 99 wait for that
  //    same rebuild (single-flight, see ./single-flight.ts). This protects Postgres from a "cache
  //    stampede". It even helps while Redis is down: Postgres still gets one query, not 100.
  //    The waiters share the first request's `now`: it is only milliseconds older than theirs.
  //    The single-flight key includes the generation. A request that saw the NEW generation must
  //    not join a rebuild that started before the event was created: that rebuild may have read
  //    Postgres before the insert, so it would hand back the old list.
  const flightKey = cacheStatus === "error" ? `${REBUILD_KEY}:no-cache` : `${REBUILD_KEY}:g${gen}`;
  const list = await singleFlight(flightKey, () => rebuild(log, now, cacheStatus, gen));
  return { events: list, cache: cacheStatus };
}

// The start of the single-flight key for the rebuild. Only this process uses it (it is not a Redis key).
const REBUILD_KEY = "events:upcoming";

// Rebuild the list of generation `gen`. Runs once per process at a time (step 4). The Redis lock
// below makes it (normally) once across ALL processes.
async function rebuild(log: Log, now: Date, cacheStatus: CacheStatus, gen: number): Promise<PublicEvent[]> {
  // 5. Redis already failed for this request: no lock, no cache write, just Postgres (same as
  //    before this step). Waiting for a lock in a broken Redis would only slow the visitor down.
  if (cacheStatus === "error") return readPostgres(log, now);

  // 6. Single-flight cannot see other API instances: each one would still send its own query.
  //    So we also take a lock in Redis, which every instance shares. A random token marks the lock
  //    as OURS, so we never release a lock that has expired and been taken by someone else.
  const token = randomUUID();
  let gotLock: boolean;
  try {
    gotLock = await eventsCache.tryLockUpcomingRebuild(gen, token, LOCK_TTL_MS);
  } catch (err) {
    // Redis broke between the read and now: same as step 5.
    log.warn({ err }, "events cache lock failed, falling back to Postgres");
    return readPostgres(log, now);
  }

  // 7. We hold the lock: we are the one instance that queries Postgres and fills the cache.
  //    The cache is written BEFORE the lock is released, so waiters find it on their next check.
  //    `finally` releases the lock on success AND on error (else others wait until it expires).
  if (gotLock) {
    try {
      // 7a. Look at the cache ONE more time first ("double-check"). Another instance may have
      //     taken the lock, filled the cache and released the lock in the short gap between our
      //     cache read (step 3) and our lock (step 6). Then the lock was free, but the work is done.
      //     Without this check we measured 2 Postgres queries (not 1) in 2 of 5 two-instance runs.
      const alreadyFilled = await recheckCache(log, gen);
      if (alreadyFilled !== null) return alreadyFilled;

      const list = await readPostgres(log, now);
      await writeCache(log, gen, list);
      return list;
    } finally {
      await releaseLock(log, gen, token);
    }
  }

  // 8. Another instance holds the lock and is rebuilding. Wait for its result in the cache.
  const fromCache = await waitForCache(log, gen);
  if (fromCache !== null) return fromCache;

  // 9. Still nothing after ~250 ms: the holder is slow or has crashed. Read Postgres ourselves.
  //    TRADE-OFF: the visitor never waits more than ~250 ms extra, at the price of an extra
  //    Postgres query in that rare case. (Waiting longer would protect Postgres more but make
  //    visitors wait; never falling back would make one dead holder break the page.)
  log.warn({ attempts: LOCK_WAIT_ATTEMPTS }, "events cache still empty after waiting for the lock holder, reading Postgres");
  const list = await readPostgres(log, now);
  await writeCache(log, gen, list);
  return list;
}

// Re-check the cache a few times, a short pause before each check. Returns the list as soon as
// it is there, or null if it never shows up (or Redis fails while we wait).
async function waitForCache(log: Log, gen: number): Promise<PublicEvent[] | null> {
  for (let attempt = 1; attempt <= LOCK_WAIT_ATTEMPTS; attempt++) {
    await sleep(LOCK_WAIT_DELAY_MS);
    try {
      const cached = await eventsCache.getUpcomingFromCache(gen);
      const list = cached === null ? null : parseCached(cached, log);
      if (list !== null) return list;
    } catch (err) {
      log.warn({ err }, "events cache read failed while waiting for the lock holder");
      return null;
    }
  }
  return null;
}

// One cache read for the double-check (step 7a). Any problem (Redis error, bad value) just means
// "not filled yet": the lock holder then reads Postgres as planned.
async function recheckCache(log: Log, gen: number): Promise<PublicEvent[] | null> {
  try {
    const cached = await eventsCache.getUpcomingFromCache(gen);
    return cached === null ? null : parseCached(cached, log);
  } catch (err) {
    log.warn({ err }, "events cache re-check failed, reading Postgres");
    return null;
  }
}

// Release our lock. A failure is only logged: the lock deletes itself after LOCK_TTL_MS anyway.
async function releaseLock(log: Log, gen: number, token: string) {
  try {
    const released = await eventsCache.releaseUpcomingRebuildLock(gen, token);
    if (!released) log.warn({ lockTtlMs: LOCK_TTL_MS }, "events cache lock had expired before release (rebuild too slow?)");
  } catch (err) {
    log.warn({ err }, "events cache lock release failed");
  }
}

// Read Postgres and pick the public fields.
async function readPostgres(log: Log, now: Date): Promise<PublicEvent[]> {
  // 10. "Upcoming" means "starts after right now". The clock is a parameter only so tests can set it.
  const rows = await events.listUpcoming(now, log);
  return rows.map(toPublicEvent);
}

// 11. Pick the public fields by hand. startsAt becomes an ISO string (JSON has no Date type),
//     which is also exactly what we store in Redis.
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

// 12. Fill the cache of generation `gen` for the next visitors. A failed write is logged and
//     ignored: the visitor already has their answer.
async function writeCache(log: Log, gen: number, list: PublicEvent[]) {
  const ttlSeconds = BASE_TTL_SECONDS + Math.floor(Math.random() * (MAX_JITTER_SECONDS + 1));
  try {
    await eventsCache.setUpcomingInCache(gen, JSON.stringify(list), ttlSeconds);
  } catch (err) {
    log.warn({ err }, "events cache write failed");
  }
}

// 13. Check cached text before trusting it. It could be cut off, or written by older code with a
//     different shape. Checking it with the SAME Zod schema the procedure uses for its output means
//     a bad value can never reach a visitor. A bad value counts as a miss (null): the rebuild
//     overwrites it, so it fixes itself.
function parseCached(text: string, log: Log): PublicEvent[] | null {
  const parsed = ListEventsOutput.safeParse(parseJson(text));
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
  // 14. Save it. A new event starts with every seat free, so seatsLeft = totalSeats. The browser
  //     sends startsAt as ISO text; Postgres wants a Date.
  //     When this line returns, the insert is COMMITTED (see queries/events.ts, `create`).
  const row = await events.create({
    title: input.title,
    venue: input.venue,
    startsAt: new Date(input.startsAt),
    totalSeats: input.totalSeats,
    seatsLeft: input.totalSeats,
  });

  // 15. Invalidate the cached list, so the very next events.list shows the new event.
  //     If the insert above failed, it threw and we never get here: nothing changed, so there is
  //     nothing to invalidate.
  await invalidateUpcomingList(log);

  return toPublicEvent(row);
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
//   any more, and Redis deletes it when its TTL runs out.
//
// IF REDIS IS DOWN (the INCR fails):
//   The event IS saved, so the request still succeeds; we only log an error. Readers keep using
//   the old generation until its key expires: the list is stale for AT MOST one TTL (~33 s).
//   That is "bounded staleness". Failing the request instead would be worse: the admin would see an
//   error for an event that was in fact created, and might create it a second time.
async function invalidateUpcomingList(log: Log) {
  try {
    const gen = await eventsCache.bumpUpcomingGeneration();
    log.debug(`events cache invalidated: generation is now ${gen}`);
  } catch (err) {
    log.error({ err }, "events cache invalidation failed: the list may be stale for up to one TTL (~33 s)");
  }
}

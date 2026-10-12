import { ListEventsOutput } from "@minitickets/shared";
import * as eventsCache from "../queries/events-cache";
import * as events from "../queries/events";

// Services: business logic. No HTTP and no SQL in here.

// @concept: cache-aside
// @concept: ttl
// 1. How long a cached list may live: 30 seconds, plus 0 to 3 random seconds (jitter).
//    Jitter: if many keys were all written at the same moment with the same TTL, they would all
//    expire at the same moment and send a burst of reads to Postgres. A few random seconds
//    spread that out. (We have one key today, so this is a habit for when there are more.)
//    Staleness: the list can be up to about 33 seconds old, for example `seatsLeft` may be a bit
//    too high. That is fine for BROWSING. Booking will always check the database, never this
//    cache, so a stale list can never cause overselling. Invalidating the key when something
//    changes (so it is fresh sooner) is a later step.
const BASE_TTL_SECONDS = 30;
const MAX_JITTER_SECONDS = 3;

// Only what we need from a logger, so this file does not depend on Fastify and tests can pass a fake.
export type Log = { warn: (obj: object, msg: string) => void };

// The answer plus how we got it, for the request log: "hit" (from Redis), "miss" (read Postgres),
// "error" (Redis down or slow, read Postgres).
export type CacheStatus = "hit" | "miss" | "error";

// Upcoming events for the public list.
export async function listUpcomingEvents(log: Log, now: Date = new Date()) {
  // @concept: graceful-degradation
  // 2. Ask the cache first. Redis is only a speed-up, so it must never be able to fail the request:
  //    an error or a timeout is caught, logged as a warning, and we carry on with Postgres.
  let cacheStatus: CacheStatus = "miss";
  try {
    const cached = await eventsCache.getUpcomingFromCache();
    if (cached !== null) {
      // 3. Cache HIT: check the text before trusting it. It could be cut off, or written by older
      //    code with a different shape. Parsing the JSON and checking it with the SAME Zod schema
      //    the procedure uses for its output means a bad value can never reach a visitor.
      const parsed = ListEventsOutput.safeParse(parseJson(cached));
      if (parsed.success) {
        return { events: parsed.data, cache: "hit" as CacheStatus };
      }
      // A bad value is treated as a miss: we read Postgres and overwrite it below. It fixes itself.
      log.warn({ issues: parsed.error.issues.length }, "events cache value is invalid, treating as a miss");
    }
  } catch (err) {
    cacheStatus = "error";
    log.warn({ err }, "events cache read failed, falling back to Postgres");
  }

  // 4. Cache MISS (or error): read Postgres. "Upcoming" means "starts after right now".
  //    The clock is a parameter only so tests can set it.
  const rows = await events.listUpcoming(now);

  // 5. Pick the public fields by hand. startsAt becomes an ISO string (JSON has no Date type),
  //    which is also exactly what we store in Redis.
  const list = rows.map((row) => ({
    id: row.id,
    title: row.title,
    venue: row.venue,
    startsAt: row.startsAt.toISOString(),
    totalSeats: row.totalSeats,
    seatsLeft: row.seatsLeft,
  }));

  // 6. Fill the cache for the next visitors. Skipped after a read error: Redis is probably down or
  //    slow, and trying again would only add another wait to this request. A failed write is
  //    logged and ignored: the visitor already has their answer.
  if (cacheStatus !== "error") {
    const ttlSeconds = BASE_TTL_SECONDS + Math.floor(Math.random() * (MAX_JITTER_SECONDS + 1));
    try {
      await eventsCache.setUpcomingInCache(JSON.stringify(list), ttlSeconds);
    } catch (err) {
      log.warn({ err }, "events cache write failed");
    }
  }

  return { events: list, cache: cacheStatus };
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

import { createHash } from "node:crypto";
import { redis } from "../redis/client";

// @concept: cache-aside
// Queries: the only code that talks to a data store (here: Redis). No business logic.
// This file only moves TEXT in and out of Redis. It does not know what is inside the text,
// whether it is valid, or how long it should live: the service decides all of that.

// @concept: cache-key-versioning
// 1. The Redis key for one list of upcoming events: e.g. "events:upcoming:v3:g7:3f9a0c1d2b4e5f60".
//    - "v3" is the shape version. When a deploy changes the shape of the cached value or the key
//      (a field added, renamed or removed), change this to the next number. The new code then reads
//      a key that does not exist yet (a clean miss) and never meets old-shaped data left behind by
//      the previous version. The old key just expires by itself after its TTL. Without a version,
//      new code could read old-shaped data for up to one TTL, right after every deploy.
//      v2 (Step 7): the value changed from a bare list to { data, fetchedAt } (stale-while-revalidate).
//      v3 (Step 8): one key PER FILTER (the hash at the end), and the value got `staleAt` (jitter).
//    - "g<gen>" is the GENERATION (see step 1b).
//    - the last part is a short HASH of the canonical filters (services/event-filters.ts), e.g. of
//      {"venue":"pune"}. WHY A HASH instead of the text itself:
//        * SHORT: always 16 characters, however long the venue is (it may be up to 200). Keys are
//          stored in memory and sent with every command, so short keys are cheaper.
//        * SAFE: only 0-9 and a-f. A venue could contain ":" (our separator), "*" (a pattern
//          character in SCAN/KEYS), spaces or emoji; none of that can reach the key.
//      The price: you cannot read the filters from the key. So the service logs the canonical text
//      next to the key (debug level), and that log line is how you find out which key is which.
//      16 hex characters = 64 bits of SHA-256. Two different filters sharing a hash (a "collision")
//      would serve one the other's list; with even a million live keys the chance is about 1 in 37 million.
// @concept: cache-stampede
// @concept: cache-invalidation
export function upcomingKey(gen: number, canonicalFilters: string): string {
  return `events:upcoming:v3:g${gen}:${shortHash(canonicalFilters)}`;
}

// The first 16 hex characters of the SHA-256 of `text`. Same text -> always the same hash.
function shortHash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

// 1b. The generation counter: a number in Redis that goes up by one every time the list changes
//     (an event is created). A missing key means 0. Readers read it FIRST and then use the key of
//     that generation; a writer only bumps it. Old generations' keys are never read again and
//     expire by their TTL. The service explains why this beats deleting the key (createEvent).
//     ONE counter for ALL filters: every filter's key contains the same "g<gen>", so one INCR
//     moves every filter to a new, empty key at once.
//     It has no shape version: it counts changes to the DATA, which has nothing to do with the shape.
export const UPCOMING_GEN_KEY = "events:upcoming:gen";

// @concept: fail-fast
// @concept: graceful-degradation
// 2. How long we wait for Redis before giving up. A healthy Redis answers in about a millisecond.
//    A slow Redis (not down, just slow) is the dangerous case: the redis client only fails fast
//    when it is disconnected, so a slow reply would make every page wait. 100 ms is far above
//    normal and still far below what a person notices. After that the service uses Postgres.
export const CACHE_TIMEOUT_MS = 100;

// 3. Reject if `promise` is not finished after `ms`. The timer is always cleared, so a fast
//    answer leaves nothing behind. (A late Redis reply is simply ignored.)
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Redis did not answer within ${ms} ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// 4. Read the current generation. A missing key (nothing was ever created) is generation 0.
//    INCR only ever stores whole numbers, so anything else means someone wrote junk by hand:
//    we throw, and the service treats it like a Redis error (it reads Postgres).
//    Throws when Redis is down or too slow, like every read here.
export async function getUpcomingGeneration(): Promise<number> {
  const value = await withTimeout(redis.get(UPCOMING_GEN_KEY), CACHE_TIMEOUT_MS);
  if (value === null) return 0;
  const gen = Number(value);
  if (!Number.isSafeInteger(gen)) throw new Error(`${UPCOMING_GEN_KEY} is not a whole number: "${value}"`);
  return gen;
}

// 5. Start a new generation: INCR adds 1 and returns the new number. It is atomic, so two admins
//    creating events at the same moment get two different numbers (never a lost update), and on a
//    missing key it starts from 0, so the first INCR returns 1.
//    The gen key has no TTL on purpose: if it expired, the number would restart at 0 and could
//    land on an old generation again.
export async function bumpUpcomingGeneration(): Promise<number> {
  return withTimeout(redis.incr(UPCOMING_GEN_KEY), CACHE_TIMEOUT_MS);
}

// 6. Read the cached JSON text under `key` (made by upcomingKey). Returns null when the key does
//    not exist (a miss). Throws when Redis is down or too slow: the service turns that into "use Postgres".
export async function getUpcomingFromCache(key: string): Promise<string | null> {
  return withTimeout(redis.get(key), CACHE_TIMEOUT_MS);
}

// @concept: ttl
// 7. Store the JSON text under `key` and let Redis delete it after `ttlMs` milliseconds
//    ("PX"; "EX" would be seconds). The caller picks the TTL (the service's HARD TTL).
export async function setUpcomingInCache(key: string, json: string, ttlMs: number): Promise<void> {
  await withTimeout(redis.set(key, json, "PX", ttlMs), CACHE_TIMEOUT_MS);
}

// 8. The Redis key of the REBUILD LOCK for the list under `key`: "lock:" + that key, e.g.
//    "lock:events:upcoming:v3:g7:3f9a0c1d2b4e5f60". Whoever holds it is the one API instance allowed
//    to rebuild that list from Postgres right now. Built from the cache key, so it has the same
//    shape version, generation and filter hash:
//    - a rebuild for the new generation never waits for a (now useless) rebuild of the old one;
//    - "pune" and "mumbai" have their own locks: rebuilding one never blocks the other;
//    - " Pune", "pune" and "PUNE" share one lock, like they share one cache entry.
export function upcomingLockKey(key: string): string {
  return `lock:${key}`;
}

// 9. Try to take the lock. One Redis command, so two instances can never both get it:
//    - NX: only set the key if it does Not eXist yet (someone else holds it -> nothing happens);
//    - PX: the key deletes itself after `ttlMs` milliseconds, so a holder that crashes can never
//      block the rebuild forever;
//    - the value is the caller's random token: it proves later who the lock belongs to.
//    Redis answers "OK" when the key was set (we hold the lock) and null when it already existed.
export async function tryLockUpcomingRebuild(key: string, token: string, ttlMs: number): Promise<boolean> {
  const reply = await withTimeout(redis.set(upcomingLockKey(key), token, "PX", ttlMs, "NX"), CACHE_TIMEOUT_MS);
  return reply === "OK";
}

// 10. Release = delete the lock key, but ONLY if it still holds OUR token.
//    WHY the check: our lock may have expired (the rebuild took longer than its TTL) and another
//    instance may have taken it since. A plain DEL would then delete THEIR lock.
//    WHY a Lua script: "GET, compare, DEL" as three separate commands leaves a gap in which the key
//    can expire and be taken by someone else. Redis runs a script as one step: nothing else can run
//    in between. KEYS[1] is the lock key, ARGV[1] our token. It returns 1 if deleted, 0 if not ours.
const RELEASE_IF_OWNER = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
else
  return 0
end`;

export async function releaseUpcomingRebuildLock(key: string, token: string): Promise<boolean> {
  const deleted = await withTimeout(redis.eval(RELEASE_IF_OWNER, 1, upcomingLockKey(key), token), CACHE_TIMEOUT_MS);
  return deleted === 1;
}

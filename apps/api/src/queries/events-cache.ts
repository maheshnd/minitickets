import { redis } from "../redis/client";

// @concept: cache-aside
// Queries: the only code that talks to a data store (here: Redis). No business logic.
// This file only moves TEXT in and out of Redis. It does not know what is inside the text,
// whether it is valid, or how long it should live: the service decides all of that.

// @concept: cache-key-versioning
// 1. The Redis key for the public list of upcoming events. The "v2" is the shape version.
//    When a deploy changes the shape of the cached value (a field added, renamed or removed), change
//    this to the next number. The new code then reads a key that does not exist yet (a clean miss) and
//    never meets old-shaped data left behind by the previous version. The old key just expires
//    by itself after its TTL. Without a version, new code could read old-shaped data for up to
//    one TTL, right after every deploy.
//    v2 (Step 7): the value changed from a bare list to { data, fetchedAt } (stale-while-revalidate).
//    The "g<gen>" part is the GENERATION (see step 1b): e.g. "events:upcoming:v2:g7".
export function upcomingKey(gen: number): string {
  return `events:upcoming:v2:g${gen}`;
}

// 1b. The generation counter: a number in Redis that goes up by one every time the list changes
//     (an event is created). A missing key means 0. Readers read it FIRST and then use the key of
//     that generation; a writer only bumps it. Old generations' keys are never read again and
//     expire by their TTL. The service explains why this beats deleting the key (createEvent).
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

// 6. Read the cached JSON text of generation `gen`. Returns null when the key does not exist (a miss).
//    Throws when Redis is down or too slow: the service turns that into "use Postgres".
export async function getUpcomingFromCache(gen: number): Promise<string | null> {
  return withTimeout(redis.get(upcomingKey(gen)), CACHE_TIMEOUT_MS);
}

// @concept: ttl
// 7. Store the JSON text under generation `gen` and let Redis delete it after `ttlMs` milliseconds
//    ("PX"; "EX" would be seconds). The caller picks the TTL (the service's HARD TTL).
export async function setUpcomingInCache(gen: number, json: string, ttlMs: number): Promise<void> {
  await withTimeout(redis.set(upcomingKey(gen), json, "PX", ttlMs), CACHE_TIMEOUT_MS);
}

// 8. The Redis key of the REBUILD LOCK for the list above. Whoever holds it is the one API
//    instance allowed to rebuild that generation's list from Postgres right now. Same "v2" as the
//    cache key, so the next shape version also gets its own lock. Same generation too: a rebuild for the new
//    generation never has to wait for a (now useless) rebuild of the old one.
export function upcomingLockKey(gen: number): string {
  return `lock:events:upcoming:v2:g${gen}`;
}

// 9. Try to take the lock. One Redis command, so two instances can never both get it:
//    - NX: only set the key if it does Not eXist yet (someone else holds it -> nothing happens);
//    - PX: the key deletes itself after `ttlMs` milliseconds, so a holder that crashes can never
//      block the rebuild forever;
//    - the value is the caller's random token: it proves later who the lock belongs to.
//    Redis answers "OK" when the key was set (we hold the lock) and null when it already existed.
export async function tryLockUpcomingRebuild(gen: number, token: string, ttlMs: number): Promise<boolean> {
  const reply = await withTimeout(redis.set(upcomingLockKey(gen), token, "PX", ttlMs, "NX"), CACHE_TIMEOUT_MS);
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

export async function releaseUpcomingRebuildLock(gen: number, token: string): Promise<boolean> {
  const deleted = await withTimeout(redis.eval(RELEASE_IF_OWNER, 1, upcomingLockKey(gen), token), CACHE_TIMEOUT_MS);
  return deleted === 1;
}

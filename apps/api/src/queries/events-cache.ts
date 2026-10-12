import { redis } from "../redis/client";

// @concept: cache-aside
// Queries: the only code that talks to a data store (here: Redis). No business logic.
// This file only moves TEXT in and out of Redis. It does not know what is inside the text,
// whether it is valid, or how long it should live: the service decides all of that.

// @concept: cache-key-versioning
// 1. The Redis key for the public list of upcoming events. The "v1" is the shape version.
//    When a deploy changes the shape of an event (a field added, renamed or removed), change
//    this to "v2". The new code then reads a key that does not exist yet (a clean miss) and
//    never meets old-shaped data left behind by the previous version. The old key just expires
//    by itself after its TTL. Without a version, new code could read old-shaped data for up to
//    30 seconds, right after every deploy.
export const UPCOMING_KEY = "events:upcoming:v1";

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

// 4. Read the cached JSON text. Returns null when the key does not exist (a miss).
//    Throws when Redis is down or too slow: the service turns that into "use Postgres".
export async function getUpcomingFromCache(): Promise<string | null> {
  return withTimeout(redis.get(UPCOMING_KEY), CACHE_TIMEOUT_MS);
}

// @concept: ttl
// 5. Store the JSON text and let Redis delete it after `ttlSeconds` ("EX"). The caller picks the TTL.
export async function setUpcomingInCache(json: string, ttlSeconds: number): Promise<void> {
  await withTimeout(redis.set(UPCOMING_KEY, json, "EX", ttlSeconds), CACHE_TIMEOUT_MS);
}

// 6. The Redis key of the REBUILD LOCK for the list above. Whoever holds it is the one API
//    instance allowed to rebuild the list from Postgres right now. Same "v1" as the cache key, so
//    a v2 deploy also gets its own lock.
export const UPCOMING_LOCK_KEY = "lock:events:upcoming:v1";

// 7. Try to take the lock. One Redis command, so two instances can never both get it:
//    - NX: only set the key if it does Not eXist yet (someone else holds it -> nothing happens);
//    - PX: the key deletes itself after `ttlMs` milliseconds, so a holder that crashes can never
//      block the rebuild forever;
//    - the value is the caller's random token: it proves later who the lock belongs to.
//    Redis answers "OK" when the key was set (we hold the lock) and null when it already existed.
export async function tryLockUpcomingRebuild(token: string, ttlMs: number): Promise<boolean> {
  const reply = await withTimeout(redis.set(UPCOMING_LOCK_KEY, token, "PX", ttlMs, "NX"), CACHE_TIMEOUT_MS);
  return reply === "OK";
}

// 8. Release = delete the lock key, but ONLY if it still holds OUR token.
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

export async function releaseUpcomingRebuildLock(token: string): Promise<boolean> {
  const deleted = await withTimeout(redis.eval(RELEASE_IF_OWNER, 1, UPCOMING_LOCK_KEY, token), CACHE_TIMEOUT_MS);
  return deleted === 1;
}

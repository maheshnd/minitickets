import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @concept: unit-tests
// The service tests fake this whole file, so they cannot show the timeout or the lock commands.
// Here we fake only the Redis client: one whose reply never comes (a slow Redis), one that answers
// at once, and (for the lock) a tiny in-memory store.
const get = vi.fn();
const set = vi.fn();
const evalScript = vi.fn();
vi.mock("../redis/client", () => ({
  redis: {
    get: (...a: unknown[]) => get(...a),
    set: (...a: unknown[]) => set(...a),
    eval: (...a: unknown[]) => evalScript(...a),
  },
}));

const {
  getUpcomingFromCache,
  setUpcomingInCache,
  tryLockUpcomingRebuild,
  releaseUpcomingRebuildLock,
  UPCOMING_KEY,
  UPCOMING_LOCK_KEY,
  CACHE_TIMEOUT_MS,
} = await import("./events-cache");

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  get.mockReset();
  set.mockReset();
  evalScript.mockReset();
});

describe("events cache queries", () => {
  it("reads the versioned key", async () => {
    get.mockResolvedValue("[]");
    await expect(getUpcomingFromCache()).resolves.toBe("[]");
    expect(get).toHaveBeenCalledWith(UPCOMING_KEY);
    expect(UPCOMING_KEY).toBe("events:upcoming:v1");
  });

  it("writes the text with the TTL in seconds (EX)", async () => {
    set.mockResolvedValue("OK");
    await setUpcomingInCache("[]", 31);
    expect(set).toHaveBeenCalledWith(UPCOMING_KEY, "[]", "EX", 31);
  });

  it("gives up on a read when Redis is too slow", async () => {
    get.mockReturnValue(new Promise(() => {})); // never answers
    const result = getUpcomingFromCache();
    const assertion = expect(result).rejects.toThrow(/did not answer/);
    await vi.advanceTimersByTimeAsync(CACHE_TIMEOUT_MS);
    await assertion;
  });

  it("gives up on a write when Redis is too slow", async () => {
    set.mockReturnValue(new Promise(() => {}));
    const result = setUpcomingInCache("[]", 30);
    const assertion = expect(result).rejects.toThrow(/did not answer/);
    await vi.advanceTimersByTimeAsync(CACHE_TIMEOUT_MS);
    await assertion;
  });
});

describe("events rebuild lock queries", () => {
  // A tiny fake Redis with one key/value store. `set` honours NX (only if the key is free) and
  // `eval` does what our release script does (delete only if the value is the given token).
  // So these tests check that OUR code sends the right key, token and options. The Lua script
  // itself only runs inside a real Redis: it was checked by hand there with redis-cli.
  function useFakeRedisStore() {
    const store = new Map<string, string>();
    set.mockImplementation(async (key: string, value: string, _px: string, _ms: number, nx?: string) => {
      if (nx === "NX" && store.has(key)) return null;
      store.set(key, value);
      return "OK";
    });
    evalScript.mockImplementation(async (_script: string, _numKeys: number, key: string, token: string) => {
      if (store.get(key) !== token) return 0;
      store.delete(key);
      return 1;
    });
    return store;
  }

  it("takes the lock with SET <lock key> <token> PX <ms> NX", async () => {
    useFakeRedisStore();
    await expect(tryLockUpcomingRebuild("token-a", 5000)).resolves.toBe(true);
    expect(set).toHaveBeenCalledWith(UPCOMING_LOCK_KEY, "token-a", "PX", 5000, "NX");
    expect(UPCOMING_LOCK_KEY).toBe("lock:events:upcoming:v1");
  });

  it("a second instance does not get a lock that is already held", async () => {
    useFakeRedisStore();
    await tryLockUpcomingRebuild("token-a", 5000);
    await expect(tryLockUpcomingRebuild("token-b", 5000)).resolves.toBe(false);
  });

  it("release with the WRONG token does nothing; with the right token it frees the lock", async () => {
    const store = useFakeRedisStore();
    await tryLockUpcomingRebuild("token-a", 5000);

    // 1. Someone else's token (e.g. our lock expired and they took it): nothing is deleted.
    await expect(releaseUpcomingRebuildLock("token-b")).resolves.toBe(false);
    expect(store.get(UPCOMING_LOCK_KEY)).toBe("token-a");

    // 2. The owner's token: the lock is gone, so the next instance can take it.
    await expect(releaseUpcomingRebuildLock("token-a")).resolves.toBe(true);
    expect(store.has(UPCOMING_LOCK_KEY)).toBe(false);
    await expect(tryLockUpcomingRebuild("token-b", 5000)).resolves.toBe(true);
  });

  it("the release script compares the token and deletes in ONE script (atomic)", async () => {
    useFakeRedisStore();
    await releaseUpcomingRebuildLock("token-a");
    const [script, numKeys, key, token] = evalScript.mock.calls[0]!;
    expect(script).toContain('redis.call("GET", KEYS[1]) == ARGV[1]');
    expect(script).toContain('redis.call("DEL", KEYS[1])');
    expect([numKeys, key, token]).toEqual([1, UPCOMING_LOCK_KEY, "token-a"]);
  });
});

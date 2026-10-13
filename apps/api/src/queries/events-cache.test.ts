import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @concept: unit-tests
// The service tests fake this whole file, so they cannot show the timeout, the keys or the commands.
// Here we fake only the Redis client: one whose reply never comes (a slow Redis), one that answers
// at once, and (for the lock) a tiny in-memory store.
const get = vi.fn();
const set = vi.fn();
const incr = vi.fn();
const evalScript = vi.fn();
vi.mock("../redis/client", () => ({
  redis: {
    get: (...a: unknown[]) => get(...a),
    set: (...a: unknown[]) => set(...a),
    incr: (...a: unknown[]) => incr(...a),
    eval: (...a: unknown[]) => evalScript(...a),
  },
}));

const {
  getUpcomingGeneration,
  bumpUpcomingGeneration,
  getUpcomingFromCache,
  setUpcomingInCache,
  tryLockUpcomingRebuild,
  releaseUpcomingRebuildLock,
  upcomingKey,
  upcomingLockKey,
  UPCOMING_GEN_KEY,
  CACHE_TIMEOUT_MS,
} = await import("./events-cache");

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  get.mockReset();
  set.mockReset();
  incr.mockReset();
  evalScript.mockReset();
});

describe("events cache queries", () => {
  it("reads the key of the given generation (shape version + generation)", async () => {
    get.mockResolvedValue("[]");
    await expect(getUpcomingFromCache(7)).resolves.toBe("[]");
    expect(get).toHaveBeenCalledWith("events:upcoming:v2:g7");
    expect(upcomingKey(7)).toBe("events:upcoming:v2:g7");
  });

  it("writes the text to the given generation's key with the TTL in milliseconds (PX)", async () => {
    set.mockResolvedValue("OK");
    await setUpcomingInCache(7, "[]", 300_000);
    expect(set).toHaveBeenCalledWith("events:upcoming:v2:g7", "[]", "PX", 300_000);
  });

  it("gives up on a read when Redis is too slow", async () => {
    get.mockReturnValue(new Promise(() => {})); // never answers
    const result = getUpcomingFromCache(0);
    const assertion = expect(result).rejects.toThrow(/did not answer/);
    await vi.advanceTimersByTimeAsync(CACHE_TIMEOUT_MS);
    await assertion;
  });

  it("gives up on a write when Redis is too slow", async () => {
    set.mockReturnValue(new Promise(() => {}));
    const result = setUpcomingInCache(0, "[]", 30_000);
    const assertion = expect(result).rejects.toThrow(/did not answer/);
    await vi.advanceTimersByTimeAsync(CACHE_TIMEOUT_MS);
    await assertion;
  });
});

describe("events generation counter queries", () => {
  it("a missing generation key means generation 0", async () => {
    get.mockResolvedValue(null);
    await expect(getUpcomingGeneration()).resolves.toBe(0);
    expect(get).toHaveBeenCalledWith(UPCOMING_GEN_KEY);
    expect(UPCOMING_GEN_KEY).toBe("events:upcoming:gen");
  });

  it("reads the stored generation as a number", async () => {
    get.mockResolvedValue("7");
    await expect(getUpcomingGeneration()).resolves.toBe(7);
  });

  it("throws on a value that is not a whole number (the service then reads Postgres)", async () => {
    get.mockResolvedValue("banana");
    await expect(getUpcomingGeneration()).rejects.toThrow(/not a whole number/);
  });

  it("bumps the generation with INCR and returns the new number", async () => {
    incr.mockResolvedValue(8);
    await expect(bumpUpcomingGeneration()).resolves.toBe(8);
    expect(incr).toHaveBeenCalledWith(UPCOMING_GEN_KEY);
  });

  it("gives up on INCR when Redis is too slow", async () => {
    incr.mockReturnValue(new Promise(() => {}));
    const result = bumpUpcomingGeneration();
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

  it("takes the lock with SET <lock key of the generation> <token> PX <ms> NX", async () => {
    useFakeRedisStore();
    await expect(tryLockUpcomingRebuild(7, "token-a", 5000)).resolves.toBe(true);
    expect(set).toHaveBeenCalledWith("lock:events:upcoming:v2:g7", "token-a", "PX", 5000, "NX");
    expect(upcomingLockKey(7)).toBe("lock:events:upcoming:v2:g7");
  });

  it("each generation has its own lock", async () => {
    useFakeRedisStore();
    await tryLockUpcomingRebuild(7, "token-a", 5000);
    await expect(tryLockUpcomingRebuild(8, "token-b", 5000)).resolves.toBe(true);
  });

  it("a second instance does not get a lock that is already held", async () => {
    useFakeRedisStore();
    await tryLockUpcomingRebuild(7, "token-a", 5000);
    await expect(tryLockUpcomingRebuild(7, "token-b", 5000)).resolves.toBe(false);
  });

  it("release with the WRONG token does nothing; with the right token it frees the lock", async () => {
    const store = useFakeRedisStore();
    await tryLockUpcomingRebuild(7, "token-a", 5000);

    // 1. Someone else's token (e.g. our lock expired and they took it): nothing is deleted.
    await expect(releaseUpcomingRebuildLock(7, "token-b")).resolves.toBe(false);
    expect(store.get(upcomingLockKey(7))).toBe("token-a");

    // 2. The owner's token: the lock is gone, so the next instance can take it.
    await expect(releaseUpcomingRebuildLock(7, "token-a")).resolves.toBe(true);
    expect(store.has(upcomingLockKey(7))).toBe(false);
    await expect(tryLockUpcomingRebuild(7, "token-b", 5000)).resolves.toBe(true);
  });

  it("the release script compares the token and deletes in ONE script (atomic)", async () => {
    useFakeRedisStore();
    await releaseUpcomingRebuildLock(7, "token-a");
    const [script, numKeys, key, token] = evalScript.mock.calls[0]!;
    expect(script).toContain('redis.call("GET", KEYS[1]) == ARGV[1]');
    expect(script).toContain('redis.call("DEL", KEYS[1])');
    expect([numKeys, key, token]).toEqual([1, upcomingLockKey(7), "token-a"]);
  });
});

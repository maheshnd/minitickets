import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @concept: unit-tests
// 1. We replace BOTH data layers with tiny fakes, so these tests need no Postgres and no Redis.
//    - the query layer fake does what the real SQL does (starts_at > now, soonest first);
//    - the cache fake is a one-slot store whose behaviour each test can change (value, error);
//    - the lock fake grants the lock by default (this instance is the only one).
//    The real SQL and the real Redis calls are checked by the e2e test and by hand (docs/24).
const allEvents = [
  { id: "c", title: "Later", venue: "V", startsAt: new Date("2026-12-01T10:00:00Z"), totalSeats: 10, seatsLeft: 0, createdAt: new Date() },
  { id: "a", title: "Past", venue: "V", startsAt: new Date("2026-01-01T10:00:00Z"), totalSeats: 10, seatsLeft: 5, createdAt: new Date() },
  { id: "b", title: "Soon", venue: "V", startsAt: new Date("2026-11-01T10:00:00Z"), totalSeats: 10, seatsLeft: 5, createdAt: new Date() },
];
const fakeQuery = async (now: Date) =>
  allEvents.filter((e) => e.startsAt > now).sort((x, y) => x.startsAt.getTime() - y.startsAt.getTime());

const listUpcoming = vi.fn(fakeQuery);
vi.mock("../queries/events", () => ({ listUpcoming: (now: Date) => listUpcoming(now) }));

const getUpcomingFromCache = vi.fn<() => Promise<string | null>>();
const setUpcomingInCache = vi.fn<(json: string, ttlSeconds: number) => Promise<void>>();
const tryLockUpcomingRebuild = vi.fn<(token: string, ttlMs: number) => Promise<boolean>>();
const releaseUpcomingRebuildLock = vi.fn<(token: string) => Promise<boolean>>();
vi.mock("../queries/events-cache", () => ({
  getUpcomingFromCache: () => getUpcomingFromCache(),
  setUpcomingInCache: (json: string, ttlSeconds: number) => setUpcomingInCache(json, ttlSeconds),
  tryLockUpcomingRebuild: (token: string, ttlMs: number) => tryLockUpcomingRebuild(token, ttlMs),
  releaseUpcomingRebuildLock: (token: string) => releaseUpcomingRebuildLock(token),
}));

const { listUpcomingEvents } = await import("./events");

const now = new Date("2026-10-12T00:00:00Z");
const log = { warn: vi.fn(), debug: vi.fn() };

// What the service should produce from the fake rows above (and what Redis would hold).
const publicList = [
  { id: "00000000-0000-4000-8000-00000000000b", title: "Soon", venue: "V", startsAt: "2026-11-01T10:00:00.000Z", totalSeats: 10, seatsLeft: 5 },
];

beforeEach(() => {
  listUpcoming.mockReset().mockImplementation(fakeQuery);
  getUpcomingFromCache.mockReset().mockResolvedValue(null); // default: empty cache = a miss
  setUpcomingInCache.mockReset().mockResolvedValue(undefined);
  tryLockUpcomingRebuild.mockReset().mockResolvedValue(true); // default: we get the lock
  releaseUpcomingRebuildLock.mockReset().mockResolvedValue(true);
  log.warn.mockClear();
});
afterEach(() => vi.useRealTimers());

describe("listUpcomingEvents: cache hit", () => {
  it("returns the cached list and does NOT call Postgres", async () => {
    getUpcomingFromCache.mockResolvedValue(JSON.stringify(publicList));

    const result = await listUpcomingEvents(log, now);

    expect(result).toEqual({ events: publicList, cache: "hit" });
    expect(listUpcoming).not.toHaveBeenCalled();
    expect(setUpcomingInCache).not.toHaveBeenCalled();
    expect(tryLockUpcomingRebuild).not.toHaveBeenCalled();
  });
});

describe("listUpcomingEvents: cache miss", () => {
  it("returns only events that start after now, soonest first", async () => {
    const result = await listUpcomingEvents(log, now);
    expect(result.events.map((e) => e.title)).toEqual(["Soon", "Later"]);
  });

  it("calls Postgres once, with the given time", async () => {
    await listUpcomingEvents(log, now);
    expect(listUpcoming).toHaveBeenCalledTimes(1);
    expect(listUpcoming).toHaveBeenCalledWith(now);
  });

  it("sends startsAt as an ISO string and leaves out createdAt", async () => {
    const result = await listUpcomingEvents(log, now);
    expect(result.events[0]).toEqual({
      id: "b",
      title: "Soon",
      venue: "V",
      startsAt: "2026-11-01T10:00:00.000Z",
      totalSeats: 10,
      seatsLeft: 5,
    });
  });

  it("writes the result to the cache once, with a TTL of 30 to 33 seconds", async () => {
    const result = await listUpcomingEvents(log, now);

    expect(result.cache).toBe("miss");
    expect(setUpcomingInCache).toHaveBeenCalledTimes(1);
    const [json, ttl] = setUpcomingInCache.mock.calls[0]!;
    expect(JSON.parse(json)).toEqual(result.events);
    expect(ttl).toBeGreaterThanOrEqual(30);
    expect(ttl).toBeLessThanOrEqual(33);
  });

  it("still returns the list when the cache write fails", async () => {
    setUpcomingInCache.mockRejectedValue(new Error("Redis went away"));

    const result = await listUpcomingEvents(log, now);

    expect(result.events).toHaveLength(2);
    expect(result.cache).toBe("miss");
    expect(log.warn).toHaveBeenCalledTimes(1);
  });
});

describe("listUpcomingEvents: Redis down or slow", () => {
  it("falls back to Postgres, succeeds, logs a warning and reports 'error'", async () => {
    getUpcomingFromCache.mockRejectedValue(new Error("Stream isn't writeable"));

    const result = await listUpcomingEvents(log, now);

    expect(result.cache).toBe("error");
    expect(result.events.map((e) => e.title)).toEqual(["Soon", "Later"]);
    expect(listUpcoming).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  it("does not try to take the lock or write the cache after a read error", async () => {
    getUpcomingFromCache.mockRejectedValue(new Error("timeout"));
    await listUpcomingEvents(log, now);
    expect(tryLockUpcomingRebuild).not.toHaveBeenCalled();
    expect(setUpcomingInCache).not.toHaveBeenCalled();
  });

  it("falls back to Postgres when taking the lock fails, and does not write the cache", async () => {
    tryLockUpcomingRebuild.mockRejectedValue(new Error("Redis did not answer within 100 ms"));

    const result = await listUpcomingEvents(log, now);

    expect(result.events.map((e) => e.title)).toEqual(["Soon", "Later"]);
    expect(listUpcoming).toHaveBeenCalledTimes(1);
    expect(setUpcomingInCache).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledTimes(1);
  });
});

describe("listUpcomingEvents: bad cached value", () => {
  // Each of these must be treated as a miss: read Postgres, overwrite the bad value, warn.
  const badValues: Record<string, string> = {
    "text that is not JSON (cut off)": '[{"id":"00000000-0000-4000-8000-00000000000b","tit',
    "an old shape (field renamed)": JSON.stringify([{ ...publicList[0], startsAt: undefined, starts_at: "2026-11-01T10:00:00.000Z" }]),
    "the wrong kind of value": JSON.stringify({ events: publicList }),
  };

  for (const [name, value] of Object.entries(badValues)) {
    it(`treats ${name} as a miss`, async () => {
      // Once: only the first read sees the bad value (the lock holder's re-check then finds nothing).
      getUpcomingFromCache.mockResolvedValueOnce(value);

      const result = await listUpcomingEvents(log, now);

      expect(result.cache).toBe("miss");
      expect(result.events.map((e) => e.title)).toEqual(["Soon", "Later"]);
      expect(listUpcoming).toHaveBeenCalledTimes(1);
      expect(setUpcomingInCache).toHaveBeenCalledTimes(1);
      expect(log.warn).toHaveBeenCalledTimes(1);
    });
  }
});

describe("stampede protection, level 1: single-flight in one process", () => {
  it("10 concurrent misses query Postgres ONCE, and all 10 get the list", async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => listUpcomingEvents(log, now)));

    expect(listUpcoming).toHaveBeenCalledTimes(1);
    expect(tryLockUpcomingRebuild).toHaveBeenCalledTimes(1);
    for (const result of results) expect(result.events.map((e) => e.title)).toEqual(["Soon", "Later"]);
  });

  it("a failed rebuild rejects all 10 waiters, and the next request tries again", async () => {
    listUpcoming.mockRejectedValueOnce(new Error("Postgres is down"));

    const settled = await Promise.allSettled(Array.from({ length: 10 }, () => listUpcomingEvents(log, now)));
    expect(settled.every((r) => r.status === "rejected")).toBe(true);
    expect(listUpcoming).toHaveBeenCalledTimes(1);
    // The lock is released even though the rebuild failed, so other instances need not wait 5 s.
    expect(releaseUpcomingRebuildLock).toHaveBeenCalledTimes(1);

    // Cleaned up: the next request starts a new rebuild (and Postgres is back).
    const result = await listUpcomingEvents(log, now);
    expect(result.events).toHaveLength(2);
    expect(listUpcoming).toHaveBeenCalledTimes(2);
  });
});

describe("stampede protection, level 2: Redis lock across instances", () => {
  it("the lock holder queries Postgres, fills the cache, THEN releases with its own token", async () => {
    await listUpcomingEvents(log, now);

    expect(listUpcoming).toHaveBeenCalledTimes(1);
    const [token, ttlMs] = tryLockUpcomingRebuild.mock.calls[0]!;
    expect(ttlMs).toBe(5000);
    expect(releaseUpcomingRebuildLock).toHaveBeenCalledWith(token);
    // Cache written before the lock is released, so waiters find it on their next check.
    expect(setUpcomingInCache.mock.invocationCallOrder[0]).toBeLessThan(
      releaseUpcomingRebuildLock.mock.invocationCallOrder[0]!,
    );
  });

  it("each rebuild uses a new random token", async () => {
    await listUpcomingEvents(log, now);
    await listUpcomingEvents(log, now);
    const [first, second] = tryLockUpcomingRebuild.mock.calls.map(([token]) => token);
    expect(first).not.toBe(second);
  });

  it("double-check: the holder finds the cache already filled and does NOT query Postgres", async () => {
    // First read: empty. Re-check after getting the lock: another instance just filled it.
    getUpcomingFromCache.mockResolvedValueOnce(null).mockResolvedValueOnce(JSON.stringify(publicList));

    const result = await listUpcomingEvents(log, now);

    expect(result.events).toEqual(publicList);
    expect(listUpcoming).not.toHaveBeenCalled();
    expect(releaseUpcomingRebuildLock).toHaveBeenCalledTimes(1);
  });

  it("without the lock: waits for the holder's list in the cache and does NOT query Postgres", async () => {
    vi.useFakeTimers();
    tryLockUpcomingRebuild.mockResolvedValue(false);
    // First read and first re-check: empty. Second re-check: the holder has written it.
    getUpcomingFromCache.mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValueOnce(JSON.stringify(publicList));

    const pending = listUpcomingEvents(log, now);
    await vi.runAllTimersAsync();
    const result = await pending;

    expect(result.events).toEqual(publicList);
    expect(listUpcoming).not.toHaveBeenCalled();
    expect(getUpcomingFromCache).toHaveBeenCalledTimes(3);
    expect(releaseUpcomingRebuildLock).not.toHaveBeenCalled(); // never ours, never released
  });

  it("lock wait timeout: the cache never fills, so it falls back to Postgres (bounded wait)", async () => {
    vi.useFakeTimers();
    tryLockUpcomingRebuild.mockResolvedValue(false); // the holder is stuck or has crashed

    const pending = listUpcomingEvents(log, now);
    await vi.runAllTimersAsync();
    const result = await pending;

    expect(result.events.map((e) => e.title)).toEqual(["Soon", "Later"]);
    expect(getUpcomingFromCache).toHaveBeenCalledTimes(1 + 5); // first read + 5 re-checks, then stop
    expect(listUpcoming).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith(expect.anything(), expect.stringContaining("still empty after waiting"));
  });

  it("two instances (two copies of the service), one shared Redis: only the lock holder queries", async () => {
    // 1. A tiny in-memory "Redis" both copies share: one cache slot and one lock slot.
    let cacheValue: string | null = null;
    let lockToken: string | null = null;
    getUpcomingFromCache.mockImplementation(async () => cacheValue);
    setUpcomingInCache.mockImplementation(async (json) => {
      cacheValue = json;
    });
    tryLockUpcomingRebuild.mockImplementation(async (token) => {
      if (lockToken !== null) return false;
      lockToken = token;
      return true;
    });
    releaseUpcomingRebuildLock.mockImplementation(async (token) => {
      if (lockToken !== token) return false;
      lockToken = null;
      return true;
    });
    // 2. Postgres takes 20 ms, so the second instance really has to wait for it. The row has a
    //    real UUID: the waiter checks the cached list with the Zod schema, which wants UUIDs.
    const row = { ...allEvents[2]!, id: publicList[0]!.id };
    listUpcoming.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return [row];
    });

    // 3. A fresh copy of the service module = a second API instance, with its OWN single-flight
    //    memory (that is exactly what level 1 cannot share).
    vi.resetModules();
    const instanceB = await import("./events");

    const results = await Promise.all([
      ...Array.from({ length: 5 }, () => listUpcomingEvents(log, now)),
      ...Array.from({ length: 5 }, () => instanceB.listUpcomingEvents(log, now)),
    ]);

    expect(listUpcoming).toHaveBeenCalledTimes(1);
    for (const result of results) expect(result.events).toEqual(publicList);
    expect(log.warn).not.toHaveBeenCalled(); // nobody gave up waiting
    expect(lockToken).toBeNull(); // released at the end
  });
});

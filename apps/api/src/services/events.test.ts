import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @concept: unit-tests
// 1. We replace BOTH data layers with tiny fakes, so these tests need no Postgres and no Redis.
//    - the query layer fake does what the real SQL does (starts_at > now, soonest first; an insert
//      adds a row that later reads see);
//    - the cache fake is a one-slot store whose behaviour each test can change (value, error);
//    - the generation is 0 by default, and bumping it works;
//    - the lock fake grants the lock by default (this instance is the only one);
//    - the key fake keeps the canonical filters READABLE ("test:g0:{"venue":"pune"}"); the real
//      key hashes them, which queries/events-cache.test.ts checks;
//    - the env fake sets the two cache TTLs to their defaults (soft 30 s, hard 5 min).
//    The real SQL and the real Redis calls are checked by the e2e test and by hand (docs/24).
//    THE CLOCK: the service takes `now` as a parameter, so each test decides how old a cached
//    value is by choosing its `fetchedAt` (see cachedValue below). That is our fake clock.
const allEvents = [
  { id: "c", title: "Later", venue: "V", startsAt: new Date("2026-12-01T10:00:00Z"), totalSeats: 10, seatsLeft: 0, createdAt: new Date() },
  { id: "a", title: "Past", venue: "V", startsAt: new Date("2026-01-01T10:00:00Z"), totalSeats: 10, seatsLeft: 5, createdAt: new Date() },
  { id: "b", title: "Soon", venue: "V", startsAt: new Date("2026-11-01T10:00:00Z"), totalSeats: 10, seatsLeft: 5, createdAt: new Date() },
];
type Row = (typeof allEvents)[number];
type NewRow = Omit<Row, "id" | "createdAt">;

// The fake "table". Reset before each test; the fake insert adds to it.
// The fake query does what the real SQL does with the (already canonical) filters: venue exact
// without case, from = on or after that day, to = up to the END of that day.
type Filters = { venue?: string; from?: Date; to?: Date };
const DAY_MS = 24 * 60 * 60 * 1000;
let dbRows: Row[] = [];
const fakeQuery = async (now: Date, filters: Filters = {}) =>
  dbRows
    .filter((e) => e.startsAt > now)
    .filter((e) => !filters.venue || e.venue.toLowerCase() === filters.venue)
    .filter((e) => !filters.from || e.startsAt >= filters.from)
    .filter((e) => !filters.to || e.startsAt.getTime() < filters.to.getTime() + DAY_MS)
    .sort((x, y) => x.startsAt.getTime() - y.startsAt.getTime());
const NEW_EVENT_ID = "00000000-0000-4000-8000-0000000000ee";
const fakeInsert = async (input: NewRow) => {
  const row = { ...input, id: NEW_EVENT_ID, createdAt: new Date() };
  dbRows.push(row);
  return row;
};

const listUpcoming = vi.fn(fakeQuery);
const create = vi.fn(fakeInsert);
vi.mock("../queries/events", () => ({
  listUpcoming: (now: Date, filters: Filters) => listUpcoming(now, filters),
  create: (input: NewRow) => create(input),
}));

// The key of the list with no filters, in generation `gen` (the key fake below).
const keyFor = (gen: number, canonical = "{}") => `test:g${gen}:${canonical}`;

const getUpcomingGeneration = vi.fn<() => Promise<number>>();
const bumpUpcomingGeneration = vi.fn<() => Promise<number>>();
const getUpcomingFromCache = vi.fn<(key: string) => Promise<string | null>>();
const setUpcomingInCache = vi.fn<(key: string, json: string, ttlMs: number) => Promise<void>>();
const tryLockUpcomingRebuild = vi.fn<(key: string, token: string, ttlMs: number) => Promise<boolean>>();
const releaseUpcomingRebuildLock = vi.fn<(key: string, token: string) => Promise<boolean>>();
vi.mock("../queries/events-cache", () => ({
  upcomingKey: (gen: number, canonical: string) => keyFor(gen, canonical),
  getUpcomingGeneration: () => getUpcomingGeneration(),
  bumpUpcomingGeneration: () => bumpUpcomingGeneration(),
  getUpcomingFromCache: (key: string) => getUpcomingFromCache(key),
  setUpcomingInCache: (key: string, json: string, ttlMs: number) => setUpcomingInCache(key, json, ttlMs),
  tryLockUpcomingRebuild: (key: string, token: string, ttlMs: number) => tryLockUpcomingRebuild(key, token, ttlMs),
  releaseUpcomingRebuildLock: (key: string, token: string) => releaseUpcomingRebuildLock(key, token),
}));

// The web app's revalidate hook (an HTTP call to the web server in real life). Resolves true
// ("sent") by default; tests make it fail or hang.
const revalidateEventsPages = vi.fn<() => Promise<boolean>>();
vi.mock("../queries/web-cache", () => ({
  revalidateEventsPages: () => revalidateEventsPages(),
}));

const SOFT_TTL_MS = 30_000;
const HARD_TTL_MS = 300_000;
vi.mock("../config/env", () => ({
  env: { EVENTS_CACHE_SOFT_TTL_MS: SOFT_TTL_MS, EVENTS_CACHE_HARD_TTL_MS: HARD_TTL_MS },
}));

// A fresh copy of the service before EVERY test (see beforeEach): it keeps some memory between
// calls (single-flight, the last failed refresh), and one test must never see another test's.
let listUpcomingEvents: typeof import("./events").listUpcomingEvents;
let createEvent: typeof import("./events").createEvent;

const now = new Date("2026-10-12T00:00:00Z");
const log = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };

// What the service should produce from the fake rows above (and what Redis would hold).
const publicList = [
  { id: "00000000-0000-4000-8000-00000000000b", title: "Soon", venue: "V", startsAt: "2026-11-01T10:00:00.000Z", totalSeats: 10, seatsLeft: 5 },
];

// The text Redis would hold: the list, when it was read from Postgres (`ageMs` before `now`), and
// when it turns stale. No jitter here (staleAt = fetchedAt + soft TTL), so "age = soft TTL" is
// exactly the first stale moment; the jitter has its own tests.
function cachedValue(list: unknown, ageMs: number): string {
  const fetchedAt = now.getTime() - ageMs;
  return JSON.stringify({ data: list, fetchedAt, staleAt: fetchedAt + SOFT_TTL_MS });
}

// A Postgres query that does not answer until the test calls `finish()`.
function holdPostgres() {
  let finish!: () => void;
  const answered = new Promise<void>((resolve) => (finish = resolve));
  listUpcoming.mockImplementation(async (at: Date, filters?: Filters) => {
    await answered;
    return fakeQuery(at, filters);
  });
  return { finish: () => finish() };
}

beforeEach(async () => {
  vi.resetModules();
  ({ listUpcomingEvents, createEvent } = await import("./events"));
  dbRows = [...allEvents];
  listUpcoming.mockReset().mockImplementation(fakeQuery);
  create.mockReset().mockImplementation(fakeInsert);
  getUpcomingGeneration.mockReset().mockResolvedValue(0); // default: nothing was ever created
  bumpUpcomingGeneration.mockReset().mockResolvedValue(1);
  getUpcomingFromCache.mockReset().mockResolvedValue(null); // default: empty cache = a miss
  setUpcomingInCache.mockReset().mockResolvedValue(undefined);
  tryLockUpcomingRebuild.mockReset().mockResolvedValue(true); // default: we get the lock
  releaseUpcomingRebuildLock.mockReset().mockResolvedValue(true);
  revalidateEventsPages.mockReset().mockResolvedValue(true);
  log.error.mockClear();
  log.warn.mockClear();
  log.debug.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks(); // undoes vi.spyOn(Math, "random") in the jitter tests
});

describe("listUpcomingEvents: fresh (younger than the soft TTL)", () => {
  it("returns the cached list and does NOT call Postgres or start a refresh", async () => {
    getUpcomingFromCache.mockResolvedValue(cachedValue(publicList, SOFT_TTL_MS - 1));

    const result = await listUpcomingEvents(undefined, log, now);

    expect(result).toEqual({ events: publicList, cache: "fresh" });
    expect(listUpcoming).not.toHaveBeenCalled();
    expect(setUpcomingInCache).not.toHaveBeenCalled();
    expect(tryLockUpcomingRebuild).not.toHaveBeenCalled();
  });
});

describe("listUpcomingEvents: cache miss", () => {
  it("returns only events that start after now, soonest first", async () => {
    const result = await listUpcomingEvents(undefined, log, now);
    expect(result.events.map((e) => e.title)).toEqual(["Soon", "Later"]);
  });

  it("calls Postgres once, with the given time", async () => {
    await listUpcomingEvents(undefined, log, now);
    expect(listUpcoming).toHaveBeenCalledTimes(1);
    expect(listUpcoming).toHaveBeenCalledWith(now, {}); // no input = no filters
  });

  it("sends startsAt as an ISO string and leaves out createdAt", async () => {
    const result = await listUpcomingEvents(undefined, log, now);
    expect(result.events[0]).toEqual({
      id: "b",
      title: "Soon",
      venue: "V",
      startsAt: "2026-11-01T10:00:00.000Z",
      totalSeats: 10,
      seatsLeft: 5,
    });
  });

  it("writes { data, fetchedAt: now, staleAt } to the cache once, with the HARD TTL (5 min, in ms)", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0); // no jitter: staleAt = now + soft TTL

    const result = await listUpcomingEvents(undefined, log, now);

    expect(result.cache).toBe("miss");
    expect(setUpcomingInCache).toHaveBeenCalledTimes(1);
    const [key, json, ttlMs] = setUpcomingInCache.mock.calls[0]!;
    expect(key).toBe(keyFor(0));
    expect(JSON.parse(json)).toEqual({ data: result.events, fetchedAt: now.getTime(), staleAt: now.getTime() + SOFT_TTL_MS });
    expect(ttlMs).toBe(HARD_TTL_MS);
  });

  it("still returns the list when the cache write fails", async () => {
    setUpcomingInCache.mockRejectedValue(new Error("Redis went away"));

    const result = await listUpcomingEvents(undefined, log, now);

    expect(result.events).toHaveLength(2);
    expect(result.cache).toBe("miss");
    expect(log.warn).toHaveBeenCalledTimes(1);
  });
});

describe("listUpcomingEvents: Redis down or slow", () => {
  it("falls back to Postgres, succeeds, logs a warning and reports 'error'", async () => {
    getUpcomingFromCache.mockRejectedValue(new Error("Stream isn't writeable"));

    const result = await listUpcomingEvents(undefined, log, now);

    expect(result.cache).toBe("error");
    expect(result.events.map((e) => e.title)).toEqual(["Soon", "Later"]);
    expect(listUpcoming).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  it("falls back to Postgres when reading the GENERATION fails, too", async () => {
    getUpcomingGeneration.mockRejectedValue(new Error("Stream isn't writeable"));

    const result = await listUpcomingEvents(undefined, log, now);

    expect(result.cache).toBe("error");
    expect(result.events.map((e) => e.title)).toEqual(["Soon", "Later"]);
    expect(getUpcomingFromCache).not.toHaveBeenCalled();
    expect(tryLockUpcomingRebuild).not.toHaveBeenCalled();
    expect(setUpcomingInCache).not.toHaveBeenCalled();
  });

  it("does not try to take the lock or write the cache after a read error", async () => {
    getUpcomingFromCache.mockRejectedValue(new Error("timeout"));
    await listUpcomingEvents(undefined, log, now);
    expect(tryLockUpcomingRebuild).not.toHaveBeenCalled();
    expect(setUpcomingInCache).not.toHaveBeenCalled();
  });

  it("falls back to Postgres when taking the lock fails, and does not write the cache", async () => {
    tryLockUpcomingRebuild.mockRejectedValue(new Error("Redis did not answer within 100 ms"));

    const result = await listUpcomingEvents(undefined, log, now);

    expect(result.events.map((e) => e.title)).toEqual(["Soon", "Later"]);
    expect(listUpcoming).toHaveBeenCalledTimes(1);
    expect(setUpcomingInCache).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledTimes(1);
  });
});

describe("listUpcomingEvents: bad cached value", () => {
  // Each of these must be treated as a miss: read Postgres, overwrite the bad value, warn.
  const badValues: Record<string, string> = {
    "text that is not JSON (cut off)": '{"data":[{"id":"00000000-0000-4000-8000-00000000000b","tit',
    "an old shape (field renamed)": cachedValue([{ ...publicList[0], startsAt: undefined, starts_at: "2026-11-01T10:00:00.000Z" }], 0),
    "the wrong kind of value": JSON.stringify({ events: publicList }),
    "a v1 value (a bare list, no fetchedAt)": JSON.stringify(publicList),
  };

  for (const [name, value] of Object.entries(badValues)) {
    it(`treats ${name} as a miss`, async () => {
      // Once: only the first read sees the bad value (the lock holder's re-check then finds nothing).
      getUpcomingFromCache.mockResolvedValueOnce(value);

      const result = await listUpcomingEvents(undefined, log, now);

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
    const results = await Promise.all(Array.from({ length: 10 }, () => listUpcomingEvents(undefined, log, now)));

    expect(listUpcoming).toHaveBeenCalledTimes(1);
    expect(tryLockUpcomingRebuild).toHaveBeenCalledTimes(1);
    for (const result of results) expect(result.events.map((e) => e.title)).toEqual(["Soon", "Later"]);
  });

  it("a failed rebuild rejects all 10 waiters, and the next request tries again", async () => {
    listUpcoming.mockRejectedValueOnce(new Error("Postgres is down"));

    const settled = await Promise.allSettled(Array.from({ length: 10 }, () => listUpcomingEvents(undefined, log, now)));
    expect(settled.every((r) => r.status === "rejected")).toBe(true);
    expect(listUpcoming).toHaveBeenCalledTimes(1);
    // The lock is released even though the rebuild failed, so other instances need not wait 5 s.
    expect(releaseUpcomingRebuildLock).toHaveBeenCalledTimes(1);

    // Cleaned up: the next request starts a new rebuild (and Postgres is back).
    const result = await listUpcomingEvents(undefined, log, now);
    expect(result.events).toHaveLength(2);
    expect(listUpcoming).toHaveBeenCalledTimes(2);
  });
});

describe("stampede protection, level 2: Redis lock across instances", () => {
  it("the lock holder queries Postgres, fills the cache, THEN releases with its own token", async () => {
    await listUpcomingEvents(undefined, log, now);

    expect(listUpcoming).toHaveBeenCalledTimes(1);
    const [gen, token, ttlMs] = tryLockUpcomingRebuild.mock.calls[0]!;
    expect(ttlMs).toBe(5000);
    expect(releaseUpcomingRebuildLock).toHaveBeenCalledWith(gen, token);
    // Cache written before the lock is released, so waiters find it on their next check.
    expect(setUpcomingInCache.mock.invocationCallOrder[0]).toBeLessThan(
      releaseUpcomingRebuildLock.mock.invocationCallOrder[0]!,
    );
  });

  it("each rebuild uses a new random token", async () => {
    await listUpcomingEvents(undefined, log, now);
    await listUpcomingEvents(undefined, log, now);
    const [first, second] = tryLockUpcomingRebuild.mock.calls.map(([, token]) => token);
    expect(first).not.toBe(second);
  });

  it("double-check: the holder finds the cache already filled and does NOT query Postgres", async () => {
    // First read: empty. Re-check after getting the lock: another instance just filled it.
    getUpcomingFromCache.mockResolvedValueOnce(null).mockResolvedValueOnce(cachedValue(publicList, 0));

    const result = await listUpcomingEvents(undefined, log, now);

    expect(result.events).toEqual(publicList);
    expect(listUpcoming).not.toHaveBeenCalled();
    expect(releaseUpcomingRebuildLock).toHaveBeenCalledTimes(1);
  });

  it("without the lock: waits for the holder's list in the cache and does NOT query Postgres", async () => {
    vi.useFakeTimers();
    tryLockUpcomingRebuild.mockResolvedValue(false);
    // First read and first re-check: empty. Second re-check: the holder has written it.
    getUpcomingFromCache.mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValueOnce(cachedValue(publicList, 0));

    const pending = listUpcomingEvents(undefined, log, now);
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

    const pending = listUpcomingEvents(undefined, log, now);
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
    setUpcomingInCache.mockImplementation(async (_key, json) => {
      cacheValue = json;
    });
    tryLockUpcomingRebuild.mockImplementation(async (_key, token) => {
      if (lockToken !== null) return false;
      lockToken = token;
      return true;
    });
    releaseUpcomingRebuildLock.mockImplementation(async (_key, token) => {
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
      ...Array.from({ length: 5 }, () => listUpcomingEvents(undefined, log, now)),
      ...Array.from({ length: 5 }, () => instanceB.listUpcomingEvents(undefined, log, now)),
    ]);

    expect(listUpcoming).toHaveBeenCalledTimes(1);
    for (const result of results) expect(result.events).toEqual(publicList);
    expect(log.warn).not.toHaveBeenCalled(); // nobody gave up waiting
    expect(lockToken).toBeNull(); // released at the end
  });
});

describe("generations: the reader reads the generation FIRST and uses it everywhere", () => {
  it("cache read, lock, cache write and release all use the current generation", async () => {
    getUpcomingGeneration.mockResolvedValue(7);

    await listUpcomingEvents(undefined, log, now);

    expect(getUpcomingFromCache).toHaveBeenCalledWith(keyFor(7));
    expect(tryLockUpcomingRebuild.mock.calls[0]![0]).toBe(keyFor(7));
    expect(setUpcomingInCache.mock.calls[0]![0]).toBe(keyFor(7));
    expect(releaseUpcomingRebuildLock.mock.calls[0]![0]).toBe(keyFor(7));
    // The generation is read before the cache AND before Postgres (createEvent explains why).
    expect(getUpcomingGeneration.mock.invocationCallOrder[0]).toBeLessThan(getUpcomingFromCache.mock.invocationCallOrder[0]!);
    expect(getUpcomingGeneration.mock.invocationCallOrder[0]).toBeLessThan(listUpcoming.mock.invocationCallOrder[0]!);
  });
});

describe("createEvent: write, then invalidate", () => {
  const input = { title: "New Show", venue: "Hall", startsAt: "2026-10-20T18:00:00.000Z", totalSeats: 40 };

  it("inserts the event with seatsLeft = totalSeats and returns the public fields", async () => {
    const result = await createEvent(input, log);

    expect(create).toHaveBeenCalledWith({
      title: "New Show",
      venue: "Hall",
      startsAt: new Date("2026-10-20T18:00:00.000Z"),
      totalSeats: 40,
      seatsLeft: 40,
    });
    expect(result).toEqual({ id: NEW_EVENT_ID, ...input, seatsLeft: 40 });
  });

  it("bumps the generation (INCR) AFTER the insert has finished, never before", async () => {
    await createEvent(input, log);

    expect(bumpUpcomingGeneration).toHaveBeenCalledTimes(1);
    expect(create.mock.invocationCallOrder[0]).toBeLessThan(bumpUpcomingGeneration.mock.invocationCallOrder[0]!);
  });

  it("does not touch the cache when the insert fails (nothing changed), and the error goes up", async () => {
    create.mockRejectedValue(new Error("violates check constraint"));

    await expect(createEvent(input, log)).rejects.toThrow("violates check constraint");
    expect(bumpUpcomingGeneration).not.toHaveBeenCalled();
  });

  it("an INCR failure (Redis down) does NOT fail the request: the event is saved, an error is logged", async () => {
    bumpUpcomingGeneration.mockRejectedValue(new Error("Redis did not answer within 100 ms"));

    const result = await createEvent(input, log);

    expect(result.title).toBe("New Show");
    expect(create).toHaveBeenCalledTimes(1);
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(log.error).toHaveBeenCalledWith(expect.anything(), expect.stringContaining("stale until its next refresh"));
  });
});

describe("createEvent: then the web cache above (the revalidate hook)", () => {
  const input = { title: "New Show", venue: "Hall", startsAt: "2026-10-20T18:00:00.000Z", totalSeats: 40 };

  it("calls the hook once, AFTER the generation bump (bottom-up: Redis first, then the web cache)", async () => {
    await createEvent(input, log);

    expect(revalidateEventsPages).toHaveBeenCalledTimes(1);
    expect(bumpUpcomingGeneration.mock.invocationCallOrder[0]).toBeLessThan(revalidateEventsPages.mock.invocationCallOrder[0]!);
  });

  it("waits for the bump to FINISH before calling the hook (not just to start)", async () => {
    // The bump answers only when we say so. Until then, the hook must not have been called.
    let finishBump!: (gen: number) => void;
    bumpUpcomingGeneration.mockReturnValue(new Promise<number>((resolve) => (finishBump = resolve)));

    const pending = createEvent(input, log);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(revalidateEventsPages).not.toHaveBeenCalled();

    finishBump(1);
    await pending;
    expect(revalidateEventsPages).toHaveBeenCalledTimes(1);
  });

  it("a failing hook does NOT fail the request: the event is returned, a warning is logged", async () => {
    revalidateEventsPages.mockRejectedValue(new Error("web revalidate hook answered 401"));

    const result = await createEvent(input, log);

    expect(result.title).toBe("New Show");
    // The warning comes from the .catch, one tick after createEvent returned (fire-and-forget).
    await vi.waitFor(() => expect(log.warn).toHaveBeenCalledTimes(1));
    expect(log.warn).toHaveBeenCalledWith(expect.anything(), expect.stringContaining("web cache revalidate failed"));
    expect(log.error).not.toHaveBeenCalled();
  });

  it("is fire-and-forget: a hook that never answers does not hold up the request", async () => {
    revalidateEventsPages.mockReturnValue(new Promise<boolean>(() => {}));

    const result = await createEvent(input, log);

    expect(result.title).toBe("New Show");
    expect(revalidateEventsPages).toHaveBeenCalledTimes(1);
  });

  it("is still called when the INCR failed (Redis down: the API then reads Postgres, so the web refill is fresh)", async () => {
    bumpUpcomingGeneration.mockRejectedValue(new Error("Redis did not answer within 100 ms"));

    await createEvent(input, log);

    expect(revalidateEventsPages).toHaveBeenCalledTimes(1);
  });

  it("is not called when the insert fails (nothing changed)", async () => {
    create.mockRejectedValue(new Error("violates check constraint"));

    await expect(createEvent(input, log)).rejects.toThrow("violates check constraint");
    expect(revalidateEventsPages).not.toHaveBeenCalled();
  });
});

describe("the stale-refill race", () => {
  it("a reader that read Postgres BEFORE the create and writes LATE only writes the OLD generation", async () => {
    // 1. A tiny in-memory Redis: the generation counter, and one slot per generation's cache key.
    //    Rows get real UUIDs, because a cache hit checks the list with the Zod schema.
    dbRows = [{ ...allEvents[2]!, id: publicList[0]!.id }];
    let gen = 0;
    const cache = new Map<string, string>();
    getUpcomingGeneration.mockImplementation(async () => gen);
    bumpUpcomingGeneration.mockImplementation(async () => ++gen);
    getUpcomingFromCache.mockImplementation(async (key) => cache.get(key) ?? null);
    setUpcomingInCache.mockImplementation(async (key, json) => {
      cache.set(key, json);
    });

    // 2. The slow reader: its Postgres query sees the table as it is NOW (before the insert),
    //    but its answer is held back until we let it go.
    let letSlowReaderFinish!: () => void;
    listUpcoming.mockImplementationOnce(async (at: Date) => {
      const snapshot = await fakeQuery(at);
      await new Promise<void>((resolve) => (letSlowReaderFinish = resolve));
      return snapshot;
    });
    const slowReader = listUpcomingEvents(undefined, log, now); // reads generation 0, misses, queries Postgres
    await vi.waitFor(() => expect(listUpcoming).toHaveBeenCalledTimes(1));

    // 3. Meanwhile an admin creates an event: the insert commits, then INCR makes it generation 1.
    await createEvent({ title: "Brand New", venue: "Hall", startsAt: "2026-10-20T18:00:00.000Z", totalSeats: 40 }, log);
    expect(gen).toBe(1);

    // 4. A reader that starts NOW reads generation 1: a miss, so it reads Postgres and sees the new
    //    event. (It does not join the slow reader's rebuild: the single-flight key has the generation.)
    const next = await listUpcomingEvents(undefined, log, now);
    expect(next.cache).toBe("miss");
    expect(next.events.map((e) => e.title)).toContain("Brand New");

    // 5. The slow reader finally finishes and writes its OLD list (no "Brand New")... to the
    //    generation 0 key, which nobody reads any more. With DEL instead of INCR it would have
    //    overwritten the one shared key, and the old list would be back for a whole TTL.
    letSlowReaderFinish();
    const slow = await slowReader;
    expect(slow.events.map((e) => e.title)).not.toContain("Brand New");
    expect(JSON.parse(cache.get(keyFor(0))!).data.map((e: { title: string }) => e.title)).not.toContain("Brand New");

    // 6. The next read is a FRESH hit on generation 1, and it has the new event.
    const after = await listUpcomingEvents(undefined, log, now);
    expect(after.cache).toBe("fresh");
    expect(after.events.map((e) => e.title)).toContain("Brand New");
    expect(listUpcoming).toHaveBeenCalledTimes(2); // the slow reader + the reader in step 4, no more
  });
});

describe("stale-while-revalidate: stale (between the soft and the hard TTL)", () => {
  it("returns the stale list at once, BEFORE the background refresh has finished", async () => {
    getUpcomingFromCache.mockResolvedValue(cachedValue(publicList, SOFT_TTL_MS)); // exactly soft = stale
    const postgres = holdPostgres();

    // 1. The answer comes back while Postgres has not answered yet: nobody waited for the refresh.
    const result = await listUpcomingEvents(undefined, log, now);
    expect(result).toEqual({ events: publicList, cache: "stale" });
    await vi.waitFor(() => expect(listUpcoming).toHaveBeenCalledTimes(1));
    expect(setUpcomingInCache).not.toHaveBeenCalled();

    // 2. Postgres answers: the refresh writes the new list (fetchedAt = now, hard TTL) and unlocks.
    postgres.finish();
    await vi.waitFor(() => expect(releaseUpcomingRebuildLock).toHaveBeenCalledTimes(1));
    const [key, json, ttlMs] = setUpcomingInCache.mock.calls[0]!;
    expect(key).toBe(keyFor(0));
    expect(JSON.parse(json).data.map((e: { title: string }) => e.title)).toEqual(["Soon", "Later"]);
    expect(JSON.parse(json).fetchedAt).toBe(now.getTime());
    expect(ttlMs).toBe(HARD_TTL_MS);
  });

  it("10 concurrent stale reads: all 10 get the stale list, and exactly ONE background refresh runs", async () => {
    getUpcomingFromCache.mockResolvedValue(cachedValue(publicList, 60_000));
    const postgres = holdPostgres();

    const results = await Promise.all(Array.from({ length: 10 }, () => listUpcomingEvents(undefined, log, now)));
    for (const result of results) expect(result).toEqual({ events: publicList, cache: "stale" });

    postgres.finish();
    await vi.waitFor(() => expect(releaseUpcomingRebuildLock).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 20)); // room for any extra refresh to show up
    expect(tryLockUpcomingRebuild).toHaveBeenCalledTimes(1);
    expect(listUpcoming).toHaveBeenCalledTimes(1);
    expect(setUpcomingInCache).toHaveBeenCalledTimes(1);
  });

  it("does NOT read Postgres when another instance holds the lock (it is refreshing already)", async () => {
    getUpcomingFromCache.mockResolvedValue(cachedValue(publicList, 60_000));
    tryLockUpcomingRebuild.mockResolvedValue(false);

    const result = await listUpcomingEvents(undefined, log, now);

    expect(result.cache).toBe("stale");
    await vi.waitFor(() => expect(tryLockUpcomingRebuild).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(listUpcoming).not.toHaveBeenCalled();
  });

  it("double-check: a refresh that finds a FRESH list (another instance just refreshed) skips Postgres", async () => {
    // First read: stale. The refresh's re-check after taking the lock: fresh.
    getUpcomingFromCache.mockResolvedValueOnce(cachedValue(publicList, 60_000)).mockResolvedValueOnce(cachedValue(publicList, 0));

    await listUpcomingEvents(undefined, log, now);

    await vi.waitFor(() => expect(releaseUpcomingRebuildLock).toHaveBeenCalledTimes(1));
    expect(listUpcoming).not.toHaveBeenCalled();
  });

  it("a list as old as the HARD TTL is never served: it counts as a miss", async () => {
    getUpcomingFromCache.mockResolvedValueOnce(cachedValue(publicList, HARD_TTL_MS));

    const result = await listUpcomingEvents(undefined, log, now);

    expect(result.cache).toBe("miss");
    expect(result.events.map((e) => e.title)).toEqual(["Soon", "Later"]);
    expect(listUpcoming).toHaveBeenCalledTimes(1);
  });
});

describe("background refresh failure", () => {
  it("is caught and logged as a warning, never thrown (no unhandled rejection)", async () => {
    getUpcomingFromCache.mockResolvedValue(cachedValue(publicList, 60_000));
    listUpcoming.mockRejectedValue(new Error("Postgres is down"));
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);

    try {
      const result = await listUpcomingEvents(undefined, log, now);
      expect(result).toEqual({ events: publicList, cache: "stale" });

      await vi.waitFor(() =>
        expect(log.warn).toHaveBeenCalledWith(
          expect.objectContaining({ cache: "stale-if-error" }),
          expect.stringContaining("background refresh failed"),
        ),
      );
      await new Promise((resolve) => setTimeout(resolve, 20)); // give Node time to report a rejection
      expect(unhandled).not.toHaveBeenCalled();
      expect(releaseUpcomingRebuildLock).toHaveBeenCalledTimes(1); // the lock is released anyway
      expect(setUpcomingInCache).not.toHaveBeenCalled(); // the stale copy is left as it is
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });
});

describe("stale-if-error", () => {
  it("Postgres down + a stale copy: the copy is served, labelled stale-if-error; the label clears when Postgres is back", async () => {
    getUpcomingFromCache.mockResolvedValue(cachedValue(publicList, 60_000));
    listUpcoming.mockRejectedValue(new Error("Postgres is down"));

    // 1. The first stale read cannot know yet: its refresh fails AFTER it has answered.
    const first = await listUpcomingEvents(undefined, log, now);
    expect(first.cache).toBe("stale");
    await vi.waitFor(() => expect(log.warn).toHaveBeenCalledTimes(1));

    // 2. Now this process knows the last refresh failed: same copy, honest label. It still starts
    //    a new refresh each time, so the list heals as soon as Postgres is back.
    const second = await listUpcomingEvents(undefined, log, now);
    expect(second).toEqual({ events: publicList, cache: "stale-if-error" });
    await vi.waitFor(() => expect(log.warn).toHaveBeenCalledTimes(2));
    expect(listUpcoming).toHaveBeenCalledTimes(2);

    // 3. Postgres is back: the next refresh works, and the label goes back to plain "stale".
    listUpcoming.mockImplementation(fakeQuery);
    expect((await listUpcomingEvents(undefined, log, now)).cache).toBe("stale-if-error");
    await vi.waitFor(() => expect(setUpcomingInCache).toHaveBeenCalledTimes(1));
    expect((await listUpcomingEvents(undefined, log, now)).cache).toBe("stale");
  });

  it("Postgres down + NO copy (a miss): the error goes up, as before", async () => {
    listUpcoming.mockRejectedValue(new Error("Postgres is down"));

    await expect(listUpcomingEvents(undefined, log, now)).rejects.toThrow("Postgres is down");
  });
});

describe("invalidation overrides SWR", () => {
  it("after a generation bump, the old list is never returned: not as stale, not even with Postgres down", async () => {
    // 1. A tiny in-memory Redis: the generation counter and one slot per generation. Generation 0
    //    holds a STALE copy of the old list (servable, if invalidation did not exist).
    dbRows = [{ ...allEvents[2]!, id: publicList[0]!.id }];
    let gen = 0;
    const cache = new Map<string, string>([[keyFor(0), cachedValue(publicList, 60_000)]]);
    getUpcomingGeneration.mockImplementation(async () => gen);
    bumpUpcomingGeneration.mockImplementation(async () => ++gen);
    getUpcomingFromCache.mockImplementation(async (key) => cache.get(key) ?? null);
    setUpcomingInCache.mockImplementation(async (key, json) => {
      cache.set(key, json);
    });

    // 2. An admin creates an event: generation 1, whose key is empty.
    await createEvent({ title: "Brand New", venue: "Hall", startsAt: "2026-10-20T18:00:00.000Z", totalSeats: 40 }, log);
    expect(gen).toBe(1);

    // 3. Postgres is down. The old list is still in generation 0, but it must NOT be used:
    //    the request fails instead of showing a list we know is out of date.
    listUpcoming.mockRejectedValueOnce(new Error("Postgres is down"));
    await expect(listUpcomingEvents(undefined, log, now)).rejects.toThrow("Postgres is down");

    // 4. Postgres is back: a MISS on generation 1 (never "stale"), with the new event.
    const result = await listUpcomingEvents(undefined, log, now);
    expect(result.cache).toBe("miss");
    expect(result.events.map((e) => e.title)).toContain("Brand New");
  });
});

// ---- Step 8: filters, canonical keys, jitter ----

// Rows for the filter tests: two venues (one written in capitals), and an event late in the
// evening (23:30 UTC) to check that "to" includes the WHOLE day. Real UUIDs, because a cache hit
// checks the list with the Zod schema.
const filterRows: Row[] = [
  { id: "00000000-0000-4000-8000-0000000000a1", title: "Pune Jazz", venue: "Pune", startsAt: new Date("2026-11-05T19:00:00Z"), totalSeats: 10, seatsLeft: 5, createdAt: new Date() },
  { id: "00000000-0000-4000-8000-0000000000a2", title: "Pune Late Show", venue: "PUNE", startsAt: new Date("2026-11-20T23:30:00Z"), totalSeats: 10, seatsLeft: 5, createdAt: new Date() },
  { id: "00000000-0000-4000-8000-0000000000a3", title: "Mumbai Rock", venue: "Mumbai", startsAt: new Date("2026-11-20T10:00:00Z"), totalSeats: 10, seatsLeft: 5, createdAt: new Date() },
];

// The first cache key one request with `input` reads (the cache fake is empty, so it is a miss).
async function keyReadFor(input: Parameters<typeof listUpcomingEvents>[0]): Promise<string> {
  getUpcomingFromCache.mockClear();
  await listUpcomingEvents(input, log, now);
  return getUpcomingFromCache.mock.calls[0]![0];
}

describe("filters: canonical cache keys", () => {
  it('" Pune", "pune" and "PUNE" read the SAME key', async () => {
    const keys = [await keyReadFor({ venue: " Pune" }), await keyReadFor({ venue: "pune" }), await keyReadFor({ venue: "PUNE" })];
    expect(new Set(keys)).toEqual(new Set([keyFor(0, '{"venue":"pune"}')]));
  });

  it("different venues or different dates read DIFFERENT keys", async () => {
    const keys = [
      await keyReadFor({ venue: "pune" }),
      await keyReadFor({ venue: "mumbai" }),
      await keyReadFor({ from: "2026-11-01" }),
      await keyReadFor({ from: "2026-11-02" }),
      await keyReadFor({ to: "2026-11-01" }),
      await keyReadFor({ venue: "pune", from: "2026-11-01" }),
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("empty filters read the same key as no filters at all", async () => {
    const keys = [await keyReadFor(undefined), await keyReadFor({}), await keyReadFor({ venue: "" }), await keyReadFor({ venue: "   " })];
    expect(new Set(keys)).toEqual(new Set([keyFor(0, "{}")]));
  });

  it("dates that differ only by the time of day share a key (rounded to the UTC day)", async () => {
    const day = await keyReadFor({ from: "2026-11-20" });
    expect(await keyReadFor({ from: "2026-11-20T18:30:00.000Z" })).toBe(day);
    expect(await keyReadFor({ from: "2026-11-20T00:00:00.000Z" })).toBe(day);
    expect(day).toBe(keyFor(0, '{"from":"2026-11-20"}'));
  });

  it("the order of the fields does not matter", async () => {
    const a = await keyReadFor({ venue: "Pune", from: "2026-11-01", to: "2026-11-30" });
    const b = await keyReadFor({ to: "2026-11-30", from: "2026-11-01", venue: "Pune" });
    expect(a).toBe(b);
    expect(a).toBe(keyFor(0, '{"from":"2026-11-01","to":"2026-11-30","venue":"pune"}'));
  });
});

describe("filters: Postgres gets the SAME canonical filters as the key", () => {
  it("venue trimmed + lowercased, dates at the start of their UTC day", async () => {
    await listUpcomingEvents({ venue: " PUNE ", from: "2026-11-20T18:30:00.000Z", to: "2026-11-21" }, log, now);

    expect(listUpcoming).toHaveBeenCalledWith(now, {
      venue: "pune",
      from: new Date("2026-11-20T00:00:00.000Z"),
      to: new Date("2026-11-21T00:00:00.000Z"),
    });
  });

  it("returns only matching events; 'to' includes the whole day", async () => {
    dbRows = [...filterRows];

    const pune = await listUpcomingEvents({ venue: "pune" }, log, now);
    expect(pune.events.map((e) => e.title)).toEqual(["Pune Jazz", "Pune Late Show"]); // "Pune" and "PUNE"

    const oneDay = await listUpcomingEvents({ from: "2026-11-20", to: "2026-11-20" }, log, now);
    expect(oneDay.events.map((e) => e.title)).toEqual(["Mumbai Rock", "Pune Late Show"]); // 10:00 and 23:30
  });
});

describe("filters: single-flight and lock use the canonical key", () => {
  it('concurrent " Pune" and "PUNE" misses share ONE rebuild; "mumbai" gets its own', async () => {
    dbRows = [...filterRows];

    const [a, b, c] = await Promise.all([
      listUpcomingEvents({ venue: " Pune" }, log, now),
      listUpcomingEvents({ venue: "PUNE" }, log, now),
      listUpcomingEvents({ venue: "mumbai" }, log, now),
    ]);

    expect(listUpcoming).toHaveBeenCalledTimes(2); // pune once, mumbai once
    expect(tryLockUpcomingRebuild.mock.calls.map(([key]) => key).sort()).toEqual(
      [keyFor(0, '{"venue":"mumbai"}'), keyFor(0, '{"venue":"pune"}')],
    );
    expect(a.events).toEqual(b.events);
    expect(c.events.map((e) => e.title)).toEqual(["Mumbai Rock"]);
  });
});

describe("generation bump invalidates EVERY filter at once", () => {
  it("one INCR: no filter, 'pune' and 'mumbai' all miss afterwards and see the new event where it matches", async () => {
    // 1. A tiny in-memory Redis: the generation counter and one slot per key.
    dbRows = [...filterRows];
    let gen = 0;
    const cache = new Map<string, string>();
    getUpcomingGeneration.mockImplementation(async () => gen);
    bumpUpcomingGeneration.mockImplementation(async () => ++gen);
    getUpcomingFromCache.mockImplementation(async (key) => cache.get(key) ?? null);
    setUpcomingInCache.mockImplementation(async (key, json) => {
      cache.set(key, json);
    });
    const inputs = [undefined, { venue: "pune" }, { venue: "mumbai" }];

    // 2. Fill three filter keys, then each is a fresh hit.
    for (const input of inputs) await listUpcomingEvents(input, log, now);
    for (const input of inputs) expect((await listUpcomingEvents(input, log, now)).cache).toBe("fresh");
    expect(cache.size).toBe(3);

    // 3. An admin creates an event in Pune: ONE generation bump, no key deleted one by one.
    create.mockImplementation(async (row: NewRow) => {
      const saved = { ...row, id: "00000000-0000-4000-8000-0000000000a4", createdAt: new Date() };
      dbRows.push(saved);
      return saved;
    });
    await createEvent({ title: "Pune Brand New", venue: "Pune", startsAt: "2026-11-10T18:00:00.000Z", totalSeats: 40 }, log);
    expect(bumpUpcomingGeneration).toHaveBeenCalledTimes(1);

    // 4. Every filter now reads a new, empty key: a MISS, never the old fresh copy.
    const after = await Promise.all(inputs.map((input) => listUpcomingEvents(input, log, now)));
    expect(after.map((r) => r.cache)).toEqual(["miss", "miss", "miss"]);
    expect(after[0]!.events.map((e) => e.title)).toContain("Pune Brand New");
    expect(after[1]!.events.map((e) => e.title)).toContain("Pune Brand New");
    expect(after[2]!.events.map((e) => e.title)).not.toContain("Pune Brand New");

    // 5. The old generation's three keys are still there (never deleted), just never read again:
    //    Redis removes them at their hard TTL.
    expect([...cache.keys()].filter((key) => key.startsWith("test:g0:"))).toHaveLength(3);
  });
});

describe("jitter on the soft TTL", () => {
  it("each written copy turns stale 0-10% after the soft TTL (Math.random picks where)", async () => {
    const staleAtFor = async (random: number) => {
      vi.spyOn(Math, "random").mockReturnValue(random);
      setUpcomingInCache.mockClear();
      await listUpcomingEvents({ venue: `v${random}` }, log, now);
      return JSON.parse(setUpcomingInCache.mock.calls[0]![1]).staleAt - now.getTime();
    };

    expect(await staleAtFor(0)).toBe(SOFT_TTL_MS); // 30 s
    expect(await staleAtFor(0.5)).toBe(SOFT_TTL_MS * 1.05); // 31.5 s
    expect(await staleAtFor(0.999999)).toBeLessThan(SOFT_TTL_MS * 1.1); // just under 33 s
  });

  it("a copy stays fresh until ITS OWN staleAt, even when it is older than the plain soft TTL", async () => {
    // Fetched 31 s ago (over the 30 s soft TTL), but its jitter made it stale only at 32 s.
    const fetchedAt = now.getTime() - 31_000;
    const value = JSON.stringify({ data: publicList, fetchedAt, staleAt: fetchedAt + 32_000 });
    getUpcomingFromCache.mockResolvedValue(value);

    expect((await listUpcomingEvents(undefined, log, now)).cache).toBe("fresh");
    expect((await listUpcomingEvents(undefined, log, new Date(fetchedAt + 32_000))).cache).toBe("stale");
  });
});

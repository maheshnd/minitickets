import { beforeEach, describe, expect, it, vi } from "vitest";

// @concept: unit-tests
// 1. We replace BOTH data layers with tiny fakes, so these tests need no Postgres and no Redis.
//    - the query layer fake does what the real SQL does (starts_at > now, soonest first);
//    - the cache fake is a one-slot store whose behaviour each test can change (value, error).
//    The real SQL and the real Redis calls are checked by the e2e test and by hand (docs/24).
const allEvents = [
  { id: "c", title: "Later", venue: "V", startsAt: new Date("2026-12-01T10:00:00Z"), totalSeats: 10, seatsLeft: 0, createdAt: new Date() },
  { id: "a", title: "Past", venue: "V", startsAt: new Date("2026-01-01T10:00:00Z"), totalSeats: 10, seatsLeft: 5, createdAt: new Date() },
  { id: "b", title: "Soon", venue: "V", startsAt: new Date("2026-11-01T10:00:00Z"), totalSeats: 10, seatsLeft: 5, createdAt: new Date() },
];

const listUpcoming = vi.fn(async (now: Date) =>
  allEvents.filter((e) => e.startsAt > now).sort((x, y) => x.startsAt.getTime() - y.startsAt.getTime()),
);
vi.mock("../queries/events", () => ({ listUpcoming: (now: Date) => listUpcoming(now) }));

const getUpcomingFromCache = vi.fn<() => Promise<string | null>>();
const setUpcomingInCache = vi.fn<(json: string, ttlSeconds: number) => Promise<void>>();
vi.mock("../queries/events-cache", () => ({
  getUpcomingFromCache: () => getUpcomingFromCache(),
  setUpcomingInCache: (json: string, ttlSeconds: number) => setUpcomingInCache(json, ttlSeconds),
}));

const { listUpcomingEvents } = await import("./events");

const now = new Date("2026-10-12T00:00:00Z");
const log = { warn: vi.fn() };

// What the service should produce from the fake rows above (and what Redis would hold).
const publicList = [
  { id: "00000000-0000-4000-8000-00000000000b", title: "Soon", venue: "V", startsAt: "2026-11-01T10:00:00.000Z", totalSeats: 10, seatsLeft: 5 },
];

beforeEach(() => {
  listUpcoming.mockClear();
  getUpcomingFromCache.mockReset().mockResolvedValue(null); // default: empty cache = a miss
  setUpcomingInCache.mockReset().mockResolvedValue(undefined);
  log.warn.mockClear();
});

describe("listUpcomingEvents: cache hit", () => {
  it("returns the cached list and does NOT call Postgres", async () => {
    getUpcomingFromCache.mockResolvedValue(JSON.stringify(publicList));

    const result = await listUpcomingEvents(log, now);

    expect(result).toEqual({ events: publicList, cache: "hit" });
    expect(listUpcoming).not.toHaveBeenCalled();
    expect(setUpcomingInCache).not.toHaveBeenCalled();
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

  it("does not try to write the cache after a read error", async () => {
    getUpcomingFromCache.mockRejectedValue(new Error("timeout"));
    await listUpcomingEvents(log, now);
    expect(setUpcomingInCache).not.toHaveBeenCalled();
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
      getUpcomingFromCache.mockResolvedValue(value);

      const result = await listUpcomingEvents(log, now);

      expect(result.cache).toBe("miss");
      expect(result.events.map((e) => e.title)).toEqual(["Soon", "Later"]);
      expect(listUpcoming).toHaveBeenCalledTimes(1);
      expect(setUpcomingInCache).toHaveBeenCalledTimes(1);
      expect(log.warn).toHaveBeenCalledTimes(1);
    });
  }
});

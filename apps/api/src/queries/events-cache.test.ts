import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @concept: unit-tests
// The service tests fake this whole file, so they cannot show the timeout. Here we fake only the
// Redis client: one whose reply never comes (a slow Redis) and one that answers at once.
const get = vi.fn();
const set = vi.fn();
vi.mock("../redis/client", () => ({ redis: { get: (...a: unknown[]) => get(...a), set: (...a: unknown[]) => set(...a) } }));

const { getUpcomingFromCache, setUpcomingInCache, UPCOMING_KEY, CACHE_TIMEOUT_MS } = await import("./events-cache");

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  get.mockReset();
  set.mockReset();
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

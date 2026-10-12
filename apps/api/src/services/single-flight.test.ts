import { describe, expect, it, vi } from "vitest";
import { singleFlight } from "./single-flight";

// singleFlight needs no fakes: the "work" is just a function we count calls to.
describe("singleFlight", () => {
  it("10 concurrent calls with the same key run the work ONCE and all get its result", async () => {
    // 1. The work only finishes on a later tick, so all 10 calls start while it is still running.
    const work = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return ["event"];
    });

    const results = await Promise.all(Array.from({ length: 10 }, () => singleFlight("k1", work)));

    expect(work).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(10);
    for (const result of results) expect(result).toEqual(["event"]);
  });

  it("a failed run rejects EVERY waiter, then is cleaned up so the next call tries again", async () => {
    const work = vi.fn<() => Promise<string>>().mockRejectedValueOnce(new Error("db down")).mockResolvedValueOnce("ok");

    // 1. 10 callers join the same failing run: all 10 get the error, the work ran once.
    const settled = await Promise.allSettled(Array.from({ length: 10 }, () => singleFlight("k2", work)));
    expect(work).toHaveBeenCalledTimes(1);
    for (const result of settled) {
      expect(result.status).toBe("rejected");
      expect((result as PromiseRejectedResult).reason).toEqual(new Error("db down"));
    }

    // 2. The failed run was removed: the next call starts new work instead of reusing the error.
    await expect(singleFlight("k2", work)).resolves.toBe("ok");
    expect(work).toHaveBeenCalledTimes(2);
  });

  it("keeps no answer after success: a later call runs the work again", async () => {
    const work = vi.fn(async () => "fresh");
    await singleFlight("k3", work);
    await singleFlight("k3", work);
    expect(work).toHaveBeenCalledTimes(2);
  });

  it("different keys do not share work", async () => {
    const work = vi.fn(async () => "x");
    await Promise.all([singleFlight("a", work), singleFlight("b", work)]);
    expect(work).toHaveBeenCalledTimes(2);
  });
});

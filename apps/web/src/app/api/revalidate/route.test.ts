import { beforeEach, describe, expect, it, vi } from "vitest";

// Unit tests for POST /api/revalidate: we call the route's POST function directly with a plain
// Request, no web server. `next/cache` is replaced by a fake, so we can see whether revalidateTag
// was called (and the fake unstable_cache just returns the function, uncached).
const revalidateTag = vi.fn();
vi.mock("next/cache", () => ({
  revalidateTag: (...args: unknown[]) => revalidateTag(...args),
  unstable_cache: (fn: unknown) => fn,
}));

const { POST } = await import("./route");

const SECRET = "a".repeat(64);

function post(headers: Record<string, string> = {}) {
  return POST(new Request("http://localhost/api/revalidate", { method: "POST", headers }));
}

beforeEach(() => {
  revalidateTag.mockClear();
  vi.stubEnv("REVALIDATE_SECRET", SECRET);
});

describe("POST /api/revalidate", () => {
  it("no secret header -> 401, nothing revalidated", async () => {
    const response = await post();

    expect(response.status).toBe(401);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("wrong secret -> 401, nothing revalidated (also one that differs only at the end, or in length)", async () => {
    for (const wrong of ["wrong", "a".repeat(63) + "b", "a".repeat(65), ""]) {
      const response = await post({ "x-revalidate-secret": wrong });
      expect(response.status).toBe(401);
    }
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("right secret -> 200, and the tag 'events' is expired NOW ({ expire: 0 }, not 'max')", async () => {
    const response = await post({ "x-revalidate-secret": SECRET });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ revalidated: true, tag: "events" });
    expect(revalidateTag).toHaveBeenCalledTimes(1);
    expect(revalidateTag).toHaveBeenCalledWith("events", { expire: 0 });
  });

  it("the web server has no (or a too short) secret -> throws (Next answers 500), even with an empty header", async () => {
    vi.stubEnv("REVALIDATE_SECRET", "");
    await expect(post({ "x-revalidate-secret": "" })).rejects.toThrow("REVALIDATE_SECRET");

    vi.stubEnv("REVALIDATE_SECRET", "short");
    await expect(post({ "x-revalidate-secret": "short" })).rejects.toThrow("REVALIDATE_SECRET");
    expect(revalidateTag).not.toHaveBeenCalled();
  });
});

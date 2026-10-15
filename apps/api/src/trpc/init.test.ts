import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictError, NotFoundError, RateLimitedError } from "../errors";
import type { Context } from "./context";

// isAdmin looks the role up through the users service (Postgres). We fake that service, so these
// tests need no database. Each test says what the "database" answers.
const getRole = vi.fn<(userId: string) => Promise<"user" | "admin" | null>>();
vi.mock("../services/users", () => ({ getRole: (userId: string) => getRole(userId) }));

const { adminProcedure, createCallerFactory, publicProcedure, router } = await import("./init");

// @concept: in-process-api-tests
// 1. A tiny router with one procedure per error we want to check. Each procedure throws
//    the way a service would. They all go through publicProcedure, so errorMapper runs.
const testRouter = router({
  notFound: publicProcedure.query(() => {
    throw new NotFoundError("no such thing");
  }),
  conflict: publicProcedure.query(() => {
    throw new ConflictError("already exists");
  }),
  crash: publicProcedure.query(() => {
    throw new Error("database exploded");
  }),
});

// 2. The procedures above never read ctx, so an empty object is enough here.
const caller = createCallerFactory(testRouter)({} as Context);

describe("errorMapper", () => {
  it("turns NotFoundError into NOT_FOUND", async () => {
    await expect(caller.notFound()).rejects.toMatchObject({ code: "NOT_FOUND", message: "no such thing" });
  });

  it("turns ConflictError into CONFLICT", async () => {
    await expect(caller.conflict()).rejects.toMatchObject({ code: "CONFLICT", message: "already exists" });
  });

  it("leaves a plain Error as INTERNAL_SERVER_ERROR", async () => {
    await expect(caller.crash()).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });
});

describe("adminProcedure", () => {
  // 1. One admin-only procedure, called as different people. Only `session` matters to the
  //    middlewares, so the rest of the context is left out. The session holds only the userId;
  //    the role comes from getRole (faked above).
  const adminRouter = router({ secret: adminProcedure.query(() => "admin stuff") });
  const callAs = (session: Context["session"]) => createCallerFactory(adminRouter)({ session } as Context).secret();
  // Default answer: a normal user. The braces matter: a function RETURNED from beforeEach is run by
  // vitest as a cleanup after the test, and mockReset() returns the mock itself (so it would be
  // called once more after every test, and fail the test when it rejects).
  beforeEach(() => {
    getRole.mockReset().mockResolvedValue("user");
  });

  it("401 UNAUTHORIZED when not logged in (we don't know who you are), without a role lookup", async () => {
    await expect(callAs(null)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(getRole).not.toHaveBeenCalled();
  });

  it("403 FORBIDDEN for a logged-in normal user (we know you, but you may not)", async () => {
    await expect(callAs({ userId: "u1" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(getRole).toHaveBeenCalledWith("u1");
  });

  it("lets an admin through", async () => {
    getRole.mockResolvedValue("admin");
    await expect(callAs({ userId: "u2" })).resolves.toBe("admin stuff");
  });

  it("401 when the session's user no longer exists (account deleted)", async () => {
    getRole.mockResolvedValue(null);
    await expect(callAs({ userId: "gone" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("reads the role on EVERY call, so a demotion counts at once", async () => {
    getRole.mockResolvedValueOnce("admin").mockResolvedValueOnce("user");
    await expect(callAs({ userId: "u3" })).resolves.toBe("admin stuff");
    await expect(callAs({ userId: "u3" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("never lets anyone through when the role lookup fails (Postgres down): 500", async () => {
    getRole.mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:5432"));
    await expect(callAs({ userId: "u4" })).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });
});

it("rate errors map to 429 and preserve the longest Retry-After in a batch", async () => {
  const header = vi.fn();
  const limited = router({ limited: publicProcedure.query(() => { throw new RateLimitedError(3); }) });
  const ctx = { res: { getHeader: () => "7", header } } as unknown as Context;
  await expect(createCallerFactory(limited)(ctx).limited()).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  expect(header).toHaveBeenCalledWith("Retry-After", "7");
});

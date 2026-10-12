import { describe, expect, it } from "vitest";
import { ConflictError, NotFoundError } from "../errors";
import type { Context } from "./context";
import { adminProcedure, createCallerFactory, publicProcedure, router } from "./init";

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
  // 1. One admin-only procedure, called as three different people. Only `session` matters to the
  //    middlewares, so the rest of the context is left out.
  const adminRouter = router({ secret: adminProcedure.query(() => "admin stuff") });
  const callAs = (session: Context["session"]) => createCallerFactory(adminRouter)({ session } as Context).secret();

  it("401 UNAUTHORIZED when not logged in (we don't know who you are)", async () => {
    await expect(callAs(null)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("403 FORBIDDEN for a logged-in normal user (we know you, but you may not)", async () => {
    await expect(callAs({ userId: "u1", role: "user" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("lets an admin through", async () => {
    await expect(callAs({ userId: "u2", role: "admin" })).resolves.toBe("admin stuff");
  });
});

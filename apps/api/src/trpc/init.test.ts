import { describe, expect, it } from "vitest";
import { ConflictError, NotFoundError } from "../errors";
import type { Context } from "./context";
import { createCallerFactory, publicProcedure, router } from "./init";

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

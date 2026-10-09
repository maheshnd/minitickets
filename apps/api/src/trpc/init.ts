import { initTRPC } from "@trpc/server";
import { ZodError, z } from "zod";
import type { Context } from "./context";

// 1. Set up tRPC once for the whole API and tell it what `ctx` looks like.
const t = initTRPC.context<Context>().create({
  // 2. Customize the error sent to the client. When input validation fails, the
  //    cause is a ZodError. We attach its per-field messages so the UI can show them,
  //    e.g. { name: ["Name is required"] }. For any other error it is null.
  errorFormatter({ shape, error }) {
    const fieldErrors: Record<string, string[] | undefined> | null =
      error.cause instanceof ZodError ? z.flattenError(error.cause).fieldErrors : null;

    return {
      ...shape,
      data: { ...shape.data, fieldErrors },
    };
  },
});

// 3. Export only the two building blocks the rest of the API needs.
//    router: groups procedures together.
//    publicProcedure: a procedure anyone can call (no login check yet).
export const router = t.router;
export const publicProcedure = t.procedure;

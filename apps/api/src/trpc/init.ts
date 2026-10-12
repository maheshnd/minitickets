import { initTRPC, TRPCError } from "@trpc/server";
import { ZodError, z } from "zod";
import { AppError, type AppErrorKind } from "../errors";
import type { Context } from "./context";

// 1. Set up tRPC once for the whole API and tell it what `ctx` looks like.
const t = initTRPC.context<Context>().create({
  // @concept: error-handling
  // 2. Customize the error sent to the client (this is the LAST step before the response).
  errorFormatter({ shape, error }) {
    // 2a. When input validation fails, the cause is a ZodError. We attach its per-field
    //     messages so the UI can show them, e.g. { name: ["Name is required"] }.
    //     The default message is the raw Zod JSON dump, so we replace it with a short one.
    const fieldErrors: Record<string, string[] | undefined> | null =
      error.cause instanceof ZodError ? z.flattenError(error.cause).fieldErrors : null;

    // 2b. Never leak internals. For a 500, the real message (and stack) stays in the
    //     server logs only; the client gets a generic message.
    const isInternal = shape.data.code === "INTERNAL_SERVER_ERROR";

    const message = isInternal
      ? "Something went wrong"
      : error.cause instanceof ZodError
        ? "Invalid input"
        : shape.message;

    return {
      ...shape,
      message,
      data: {
        ...shape.data,
        // tRPC adds a stack trace in development. File paths are internals, so always drop it.
        stack: undefined,
        fieldErrors,
      },
    };
  },
});

// @concept: http-status-codes
// 3. Which tRPC code each AppError kind becomes.
const codeByKind: Record<AppErrorKind, TRPCError["code"]> = {
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  FORBIDDEN: "FORBIDDEN",
  BAD_REQUEST: "BAD_REQUEST",
  UNAUTHORIZED: "UNAUTHORIZED",
};

// @concept: trpc-middleware
// 4. errorMapper: a middleware that wraps every procedure.
//    `next()` runs the procedure and returns its result instead of throwing, so we can look at it.
const errorMapper = t.middleware(async ({ next }) => {
  const result = await next();

  // 4a. Success, or an error that is not ours (e.g. a ZodError, or a crash): pass it through unchanged.
  if (result.ok || !(result.error.cause instanceof AppError)) {
    return result;
  }

  // 4b. A business error from a service: throw the matching TRPCError.
  //     We keep the AppError as `cause` so the logs still show where it came from.
  const appError = result.error.cause;
  throw new TRPCError({
    code: codeByKind[appError.kind],
    message: appError.message,
    cause: appError,
  });
});

// @concept: protected-procedure
// @concept: authn-vs-authz
// 5. isAuthed: a middleware that only lets logged-in callers through.
//    This is the REAL security check for private data. A frontend guard can be skipped
//    by anyone who calls the API directly (curl, scripts), this cannot.
const isAuthed = t.middleware(({ ctx, next }) => {
  if (!ctx.session) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "You must be logged in" });
  }
  // Passing `session` to next() replaces ctx.session with the non-null version, so in a
  // protected procedure TypeScript then knows ctx.session.userId exists (no null check needed).
  return next({ ctx: { session: ctx.session } });
});

// 6. Export only the building blocks the rest of the API needs.
//    router: groups procedures together.
//    publicProcedure: a procedure anyone can call (no login check yet), with error mapping.
export const router = t.router;
//    createCallerFactory: lets tests call a router directly as a function, with no HTTP server.
export const createCallerFactory = t.createCallerFactory;
//    protectedProcedure: a public procedure plus the login check above.
export const publicProcedure = t.procedure.use(errorMapper);
export const protectedProcedure = publicProcedure.use(isAuthed);

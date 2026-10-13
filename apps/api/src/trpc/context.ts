// Type-only import: it adds `req.cookies` and `res.setCookie` to Fastify's types. Without it, the web
// app (which type-checks this file through AppRouter, without app.ts) can't see those methods.
import type {} from "@fastify/cookie";
import type { CreateFastifyContextOptions } from "@trpc/server/adapters/fastify";
import * as sessions from "../queries/sessions";

// The name of the session cookie.
export const SESSION_COOKIE = "sid";

// Builds the "context" object. tRPC calls this once per request, and every
// procedure receives the result as `ctx`.
// @concept: trpc-context
export async function createContext({ req, res }: CreateFastifyContextOptions) {
  // 1. The raw session id from the "sid" cookie, or undefined if the browser sent none.
  const sessionId = req.cookies[SESSION_COOKIE];

  // 2. Check it against Redis once, here, so no procedure has to. A missing, fake or expired
  //    id all give null.
  const stored = sessionId ? await sessions.get(sessionId) : null;

  // 2b. The session holds only WHO is calling (the userId), never the ROLE. We do NOT look up the
  //     role here: this runs for EVERY request, and a lookup here would make every route depend on
  //     Postgres for something only admin routes need. Example (a real bug before): with Postgres
  //     down, a logged-in visitor got an error on events.list, although the events cache still had
  //     a copy to serve (stale-if-error). Public and normal routes must not depend on a lookup that
  //     only admin routes need, so adminProcedure reads the role itself (trpc/init.ts, isAdmin).
  //     If the account was deleted, the session still says "logged in"; procedures that need the
  //     user row already handle "no such user" (account.getProfile: 404, auth.me: null).
  const session = stored ? { userId: stored.userId } : null;

  return {
    // 3. req and res let procedures read and set cookies. Only procedures use them;
    //    services never see HTTP.
    req,
    res,
    // 4. Kept for logout, which must delete the session by its id.
    sessionId,
    // 5. Who is calling: { userId } or null (logged out). `protectedProcedure` and
    //    `adminProcedure` rely on this.
    session,
  };
}

// The type of `ctx`, derived from whatever createContext resolves to.
export type Context = Awaited<ReturnType<typeof createContext>>;

// Type-only import: it adds `req.cookies` and `res.setCookie` to Fastify's types. Without it, the web
// app (which type-checks this file through AppRouter, without app.ts) can't see those methods.
import type {} from "@fastify/cookie";
import type { CreateFastifyContextOptions } from "@trpc/server/adapters/fastify";
import * as sessions from "../queries/sessions";
import * as users from "../queries/users";

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

  // 2b. Look up the user's ROLE in Postgres (one primary-key lookup, about a millisecond).
  //     WHY Postgres on every request, and not a copy of the role saved in the session at login:
  //     a copy would stay old until the session expires (7 days). Making someone admin would only
  //     work after they log in again, and, much worse, taking admin AWAY would not work for a week.
  //     Reading it here means a role change counts from the very next request.
  //     If the user row is gone (account deleted), the session is worth nothing: treat it as logged out.
  const user = stored ? await users.findById(stored.userId) : undefined;
  const session = user ? { userId: user.id, role: user.role } : null;

  return {
    // 3. req and res let procedures read and set cookies. Only procedures use them;
    //    services never see HTTP.
    req,
    res,
    // 4. Kept for logout, which must delete the session by its id.
    sessionId,
    // 5. Who is calling: { userId, role } or null (logged out). `protectedProcedure` and
    //    `adminProcedure` rely on this.
    session,
  };
}

// The type of `ctx`, derived from whatever createContext resolves to.
export type Context = Awaited<ReturnType<typeof createContext>>;

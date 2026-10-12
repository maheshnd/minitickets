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
  //    id all give null. Otherwise we keep only the userId: the one thing procedures need.
  const stored = sessionId ? await sessions.get(sessionId) : null;
  const session = stored ? { userId: stored.userId } : null;

  return {
    // 3. req and res let procedures read and set cookies. Only procedures use them;
    //    services never see HTTP.
    req,
    res,
    // 4. Kept for logout, which must delete the session by its id.
    sessionId,
    // 5. Who is calling: { userId } or null (logged out). `protectedProcedure` relies on this.
    session,
  };
}

// The type of `ctx`, derived from whatever createContext resolves to.
export type Context = Awaited<ReturnType<typeof createContext>>;

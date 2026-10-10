// Type-only import: it adds `req.cookies` and `res.setCookie` to Fastify's types. Without it, the web
// app (which type-checks this file through AppRouter, without app.ts) can't see those methods.
import type {} from "@fastify/cookie";
import type { CreateFastifyContextOptions } from "@trpc/server/adapters/fastify";

// The name of the session cookie.
export const SESSION_COOKIE = "sid";

// Builds the "context" object. tRPC calls this once per request, and every
// procedure receives the result as `ctx`.
export function createContext({ req, res }: CreateFastifyContextOptions) {
  return {
    // 1. req and res let procedures read and set cookies. Only procedures use them;
    //    services never see HTTP.
    req,
    res,
    // 2. The raw session id from the "sid" cookie, or undefined if the browser sent none.
    //    It is NOT checked yet: the id could be fake or expired. The `me` query checks it.
    sessionId: req.cookies[SESSION_COOKIE],
  };
}

// The type of `ctx`, derived from whatever createContext returns.
export type Context = ReturnType<typeof createContext>;

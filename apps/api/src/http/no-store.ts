import type { FastifyInstance } from "fastify";

// The Cache-Control value every API response gets unless a route sets its own.
// no-store = "do not keep a copy, anywhere": not in the browser's cache, not in CloudFront, not in
// any proxy in between. Stronger than no-cache (which still allows a stored copy that is re-checked).
export const NO_STORE = "no-store";

// A default "Cache-Control: no-store" on EVERY response of the API (all of /trpc/*, and also
// /health, /ready, 404s and CORS preflights).
//
// WHY: tRPC responses can contain user data ("who am I", "my profile", the login answer with its
// Set-Cookie). A SHARED cache (CloudFront, a company proxy) that stored one of them could hand
// visitor A's answer to visitor B. Shared caches must never store them. CloudFront's /trpc/*
// behavior already has caching disabled, but that protects only that one hop: the header travels
// with the response and tells EVERY cache on the way, including ones we don't control.
//
// 1. onRequest is the first hook of every request, so the header is set before any route runs.
//    Registered on the root app, BEFORE any plugin, so it covers every route and plugin
//    (including @fastify/cors, which answers preflights in its own onRequest hook).
// 2. reply.header() only sets a DEFAULT: a route that calls reply.header("cache-control", ...)
//    later replaces it. No route does today; a public, cacheable answer would have to opt in on
//    purpose (and must then never depend on the session cookie).
// 3. Not a path check like url.startsWith("/trpc"): the whole API is private or live data, and
//    "everything" can't be forgotten when a new route is added.
export function addNoStoreDefault(app: FastifyInstance): void {
  app.addHook("onRequest", async (_request, reply) => {
    reply.header("cache-control", NO_STORE);
  });
}

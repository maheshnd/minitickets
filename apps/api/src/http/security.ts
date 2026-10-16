import type { FastifyInstance } from "fastify";

// 1. Browsers must present the exact web origin for every state-changing request. CORS alone
//    does not stop simple cross-site POSTs; absent Origin is refused too (CLI clients set it).
// @concept: csrf
export function mutationAllowed(origin: string | undefined, site: string | undefined, webOrigin: string) {
  return origin === new URL(webOrigin).origin && site !== "cross-site";
}
export function addSecurity(app: FastifyInstance, webOrigin: string) {
  app.addHook("onRequest", async (request, reply) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "strict-origin-when-cross-origin");
    reply.header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method) &&
        !mutationAllowed(request.headers.origin, request.headers["sec-fetch-site"] as string | undefined, webOrigin)) {
      return reply.code(403).send({ error: "Request origin is not allowed" });
    }
  });
}

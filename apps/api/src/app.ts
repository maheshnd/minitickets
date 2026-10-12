import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import { fastifyTRPCPlugin, type FastifyTRPCPluginOptions } from "@trpc/server/adapters/fastify";
import Fastify, { type FastifyError } from "fastify";
import { env } from "./config/env";
import { trustProxyHops } from "./config/trust-proxy";
import { pingDb, pingRedis } from "./queries/health";
import { createContext } from "./trpc/context";
import { appRouter, type AppRouter } from "./trpc/router";

// Builds and configures the Fastify app, but does NOT start it.
// Keeping "build" (here) apart from "listen" (server.ts) makes the app easy to test later.
// @concept: fastify-app
export async function buildApp() {
  // @concept: structured-logging
  // @concept: log-redaction
  // 1. Create the Fastify instance. The logger prints each request to the terminal.
  //    redact replaces these fields with "[Redacted]" if they ever appear in a log line,
  //    so passwords can never end up in log files. (We also never log request bodies or hashes.)
  const app = Fastify({
    logger: {
      redact: {
        paths: [
          "password",
          "confirmPassword",
          "passwordHash",
          "*.password",
          "*.confirmPassword",
          "*.passwordHash",
          "*.*.password",
          "*.*.confirmPassword",
          "*.*.passwordHash",
        ],
        censor: "[Redacted]",
      },
    },
    // @concept: trust-proxy
    // 1b. Proxies: on AWS every request reaches us through CloudFront and the load balancer, so the
    //     connection always comes from the load balancer. trustProxy makes request.ip (and the
    //     remoteAddress in every request log line) the REAL visitor's IP, read from the
    //     X-Forwarded-For header, and request.protocol come from X-Forwarded-Proto.
    //     WHY: real client IPs in the logs now, and per-visitor rate limiting later.
    //     Locally TRUST_PROXY_HOPS is 0, so nothing changes: trust nobody (see ./config/trust-proxy.ts).
    trustProxy: trustProxyHops(env.TRUST_PROXY_HOPS),
  });

  // @concept: cors
  // 2. CORS: the web app (:3000) and API (:4000) are different origins, so the
  //    browser blocks the calls unless the API explicitly allows the web origin.
  //    credentials: true lets the browser send and receive cookies on these calls. It only
  //    works with one exact origin (never "*"), so a random website can't use our cookie.
  await app.register(cors, { origin: env.WEB_ORIGIN, credentials: true });

  // 2b. Cookies: adds `req.cookies` (read) and `reply.setCookie` (write).
  await app.register(cookie);

  // @concept: error-handling
  // 3. Error handler for plain Fastify routes (like /health). tRPC routes never reach it,
  //    because tRPC catches its own errors and uses the onError hook below.
  app.setErrorHandler<FastifyError>((error, request, reply) => {
    const statusCode = error.statusCode ?? 500;

    if (statusCode >= 500) {
      // Unexpected: log the real error (message + stack), tell the client nothing.
      request.log.error({ reqId: request.id, err: error }, "request failed");
      return reply.status(500).send({ error: "Something went wrong" });
    }

    // The caller's mistake (4xx): a short warning is enough, and the message is safe to show.
    request.log.warn({ reqId: request.id, code: error.code }, "request rejected");
    return reply.status(statusCode).send({ error: error.message });
  });

  // @concept: health-checks
  // 4. Liveness: "is the process up?" Always 200 while the server can answer at all.
  //    It must NOT check the database, or a DB outage would make orchestrators restart a healthy API.
  app.get("/health", async () => ({ status: "ok" }));

  // @concept: http-status-codes
  // 5. Readiness: "can the API do real work right now?" Pings Postgres AND Redis.
  //    200 if both answer, 503 (Service Unavailable) if either does not.
  //    allSettled waits for both, so one failure never hides the other in the log.
  app.get("/ready", async (request, reply) => {
    const [db, redis] = await Promise.allSettled([pingDb(), pingRedis()]);

    if (db.status === "rejected") request.log.error({ err: db.reason }, "database not ready");
    if (redis.status === "rejected") request.log.error({ err: redis.reason }, "redis not ready");

    if (db.status === "rejected" || redis.status === "rejected") {
      return reply.status(503).send({ status: "unavailable" });
    }
    return { status: "ready" };
  });

  // 6. Mount tRPC: every request to /trpc/* is handled by appRouter.
  await app.register(fastifyTRPCPlugin, {
    prefix: "/trpc",
    trpcOptions: {
      router: appRouter,
      createContext,
      // @concept: correlation-ids
      // onError runs for every failed procedure, after the error is mapped. It only LOGS;
      // the response the client gets is decided by the errorFormatter.
      onError({ path, error, req }) {
        if (error.code === "INTERNAL_SERVER_ERROR") {
          // `error.cause` is the original error (e.g. "db password leaked"), with its stack.
          app.log.error({ reqId: req.id, path, err: error.cause ?? error }, "procedure crashed");
        } else {
          app.log.warn({ reqId: req.id, path, code: error.code }, "procedure rejected");
        }
      },
      // `satisfies` asks TypeScript to check these options against our router's types.
    } satisfies FastifyTRPCPluginOptions<AppRouter>["trpcOptions"],
  });

  return app;
}

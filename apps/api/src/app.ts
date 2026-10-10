import cors from "@fastify/cors";
import { fastifyTRPCPlugin, type FastifyTRPCPluginOptions } from "@trpc/server/adapters/fastify";
import Fastify, { type FastifyError } from "fastify";
import { env } from "./config/env";
import { pingDb } from "./queries/health";
import { createContext } from "./trpc/context";
import { appRouter, type AppRouter } from "./trpc/router";

// Builds and configures the Fastify app, but does NOT start it.
// Keeping "build" (here) apart from "listen" (server.ts) makes the app easy to test later.
export async function buildApp() {
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
  });

  // 2. CORS: the web app (:3000) and API (:4000) are different origins, so the
  //    browser blocks the calls unless the API explicitly allows the web origin.
  await app.register(cors, { origin: env.WEB_ORIGIN });

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

  // 4. Liveness: "is the process up?" Always 200 while the server can answer at all.
  //    It must NOT check the database, or a DB outage would make orchestrators restart a healthy API.
  app.get("/health", async () => ({ status: "ok" }));

  // 5. Readiness: "can the API do real work right now?" Runs `select 1`.
  //    200 if the database answers, 503 (Service Unavailable) if not.
  app.get("/ready", async (request, reply) => {
    try {
      await pingDb();
      return { status: "ready" };
    } catch (err) {
      request.log.error({ err }, "database not ready");
      return reply.status(503).send({ status: "unavailable" });
    }
  });

  // 6. Mount tRPC: every request to /trpc/* is handled by appRouter.
  await app.register(fastifyTRPCPlugin, {
    prefix: "/trpc",
    trpcOptions: {
      router: appRouter,
      createContext,
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

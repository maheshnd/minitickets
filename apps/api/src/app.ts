import cors from "@fastify/cors";
import { fastifyTRPCPlugin, type FastifyTRPCPluginOptions } from "@trpc/server/adapters/fastify";
import Fastify, { type FastifyError } from "fastify";
import { env } from "./config/env";
import { createContext } from "./trpc/context";
import { appRouter, type AppRouter } from "./trpc/router";

// Builds and configures the Fastify app, but does NOT start it.
// Keeping "build" (here) apart from "listen" (server.ts) makes the app easy to test later.
export async function buildApp() {
  // 1. Create the Fastify instance. logger: true prints each request to the terminal.
  const app = Fastify({ logger: true });

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

  // 4. A plain health check route (no tRPC). Handy for checking the server is up.
  app.get("/health", async () => ({ status: "ok" }));

  // 5. Mount tRPC: every request to /trpc/* is handled by appRouter.
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

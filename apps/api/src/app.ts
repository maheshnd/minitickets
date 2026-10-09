import cors from "@fastify/cors";
import { fastifyTRPCPlugin, type FastifyTRPCPluginOptions } from "@trpc/server/adapters/fastify";
import Fastify from "fastify";
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

  // 3. A plain health check route (no tRPC). Handy for checking the server is up.
  app.get("/health", async () => ({ status: "ok" }));

  // 4. Mount tRPC: every request to /trpc/* is handled by appRouter.
  await app.register(fastifyTRPCPlugin, {
    prefix: "/trpc",
    trpcOptions: {
      router: appRouter,
      createContext,
      // `satisfies` asks TypeScript to check these options against our router's types.
    } satisfies FastifyTRPCPluginOptions<AppRouter>["trpcOptions"],
  });

  return app;
}

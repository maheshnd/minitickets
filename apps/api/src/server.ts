import { buildApp } from "./app";
import { env } from "./config/env";

// Entry point of the API (run by `pnpm dev`).

// 1. Build the configured Fastify app.
const app = await buildApp();

// 2. Start listening for HTTP requests. If the port is taken, log it and exit.
try {
  await app.listen({ port: env.PORT });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

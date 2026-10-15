import { buildApp } from "./app";
import { env } from "./config/env";
import { pool } from "./db/client";
import { redis } from "./redis/client";
import { startInventoryReconciliation } from "./services/inventory-reconciliation";
import { startOutboxRelay } from "./services/outbox";

// Entry point of the API (run by `pnpm dev`).

// 1. Build the configured Fastify app.
const app = await buildApp();

// @concept: fastify-app
// 2. Start listening for HTTP requests. If the port is taken, log it and exit.
try {
  await app.listen({ port: env.PORT, host: env.HOST });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

// 2b. Say it once at startup if the web revalidate hook is off (see config/env.ts): then a new
//     event shows on the server-rendered /events only after the web cache's 30 s, not at once.
if (!env.WEB_INTERNAL_URL) {
  app.log.warn("WEB_INTERNAL_URL and REVALIDATE_SECRET are not set: the web revalidate hook is off (new events reach /events within 30 s)");
}

// 2c. Same for the booking-events topic (config/env.ts): without BOOKING_EVENTS_TOPIC_ARN no confirmation messages are sent.
if (!env.BOOKING_EVENTS_TOPIC_ARN) {
  app.log.warn("BOOKING_EVENTS_TOPIC_ARN is not set: outbox delivery is paused (booking confirmations remain in Postgres)");
}

// 2d. Each API task relays committed messages; Postgres row locks divide work between tasks.
const stopOutboxRelay = startOutboxRelay(app.log);
const stopInventoryReconciliation = startInventoryReconciliation(app.log);

// @concept: graceful-shutdown
// 3. Graceful shutdown: on Ctrl+C (SIGINT) or `kill` (SIGTERM), finish cleanly instead of dying mid-request.
let shuttingDown = false;

async function shutdown(signal: string) {
  // A second signal while we are already shutting down is ignored.
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, "shutting down");

  try {
    // 3a. Stop accepting new requests and wait for in-flight ones to finish.
    await app.close();
    // 3a2. Finish the relay's current batch before closing the database it is still using.
    await stopOutboxRelay();
    await stopInventoryReconciliation();
    // 3b. Only then close the data stores (requests may still need them until they finish).
    //     redis.quit() sends QUIT and waits for pending replies, so nothing is cut off.
    await pool.end();
    // If Redis is already down, quit() fails; disconnect() just drops the socket.
    await redis.quit().catch(() => redis.disconnect());
    app.log.info("shutdown complete: server closed, database pool and redis closed");
    process.exit(0);
  } catch (err) {
    app.log.error({ err }, "shutdown failed");
    process.exit(1);
  }
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

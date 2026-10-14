import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "../config/env";
import * as bookings from "./schema/bookings";
import * as events from "./schema/events";
import * as users from "./schema/users";

// @concept: connection-pooling
// 1. A Pool keeps a small set of open database connections and reuses them.
//    Opening a connection is slow (network + login), so we do it a few times
//    and share them, instead of once per request.
//    `max` is the most connections open at once. If all are busy, extra queries
//    wait in line. Postgres itself allows only ~100 connections in total, so
//    we keep our share small and explicit.
//    env.database is either { connectionString } (local) or host, user, password + SSL (AWS).
export const pool = new Pool({
  ...env.database,
  max: 10,
});

// @concept: fail-fast
// 2. If the database restarts or stops, idle connections in the pool break and the pool
//    emits an "error" event. Node crashes the whole process when an "error" event has no
//    listener, so we log it instead. The pool drops the dead connection and opens a new
//    one on the next query, so the API recovers by itself when the database returns.
pool.on("error", (err) => {
  console.error("Idle database connection failed:", err.message);
});

// @concept: drizzle-schema
// 3. The Drizzle instance wraps the pool. Queries use `db`; shutdown closes `pool`.
export const db = drizzle(pool, { schema: { ...users, ...events, ...bookings } });

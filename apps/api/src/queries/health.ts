import { pool } from "../db/client";
import { redis } from "../redis/client";

// @concept: health-checks
// Asks each data store a trivial question. Each throws if its store can't answer.
// Used by GET /ready. (Queries are the only code allowed to touch a data store.)
export async function pingDb() {
  await pool.query("select 1");
}

export async function pingRedis() {
  await redis.ping();
}

import { pool } from "../db/client";

// Asks the database a trivial question. Throws if the database can't answer.
// Used by GET /ready. (Queries are the only code allowed to touch the database.)
export async function pingDb() {
  await pool.query("select 1");
}

import { EmailSchema } from "@minitickets/shared";
import { redis } from "../redis/client";
import { pool } from "../db/client";
import { AppError } from "../errors";
import { makeAdmin } from "../services/users";

// Makes an existing user an admin. There is no UI for roles on purpose: changing who is an admin
// should need access to the server, not just a browser.
// Run it with: pnpm --filter @minitickets/api user:make-admin you@example.com
// It reads apps/api/.env (like the API does) and talks to the database in DATABASE_URL.

// 1. The email from the command line is outside input too: check and clean it with the same schema
//    signup uses (trim + lowercase), so "  Bob@X.com " finds the account "bob@x.com".
const parsed = EmailSchema.safeParse(process.argv[2]);

if (!parsed.success) {
  console.error("Usage: pnpm --filter @minitickets/api user:make-admin <email>");
  process.exitCode = 1;
} else {
  try {
    // 2. Same path as the API: service -> query -> Postgres.
    const user = await makeAdmin(parsed.data);
    console.log(`${user.email} is now an admin. Existing sessions were revoked; they must log in again.`);
  } catch (err) {
    // 3. Our own errors (e.g. "no user with this email") have a clear message; anything else is a
    //    real failure, so print all of it.
    console.error(err instanceof AppError ? err.message : err);
    process.exitCode = 1;
  } finally {
    // 4. Close the database connections, otherwise Node would wait for them and never exit.
    await pool.end();
    await redis.quit().catch(() => redis.disconnect());
  }
}

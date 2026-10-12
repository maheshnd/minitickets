import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { z } from "zod";
import { DatabaseEnvSchema } from "../config/database";

// @concept: migrations
// Applies the SQL files in ./drizzle to the database, then exits.
// In Docker it runs as a separate one-off container (`node dist/migrate.js`), NOT inside
// the API: with several API containers starting together, they would all migrate at once.
// On AWS it runs as a one-off ECS task (scripts/run-migrations.sh).
// It is NOT built on drizzle-kit, because drizzle-kit is a dev tool that is not in the production image.

// 1. This script needs only the database settings, so it validates only those
//    (config/env.ts would also demand PORT, REDIS_URL, ... which a migration does not use).
//    Same rules as the API: DATABASE_URL locally, or DB_* with SSL on AWS.
const result = DatabaseEnvSchema.safeParse(process.env);
if (!result.success) {
  console.error("Invalid database settings:", z.flattenError(result.error).formErrors);
  process.exit(1);
}

// 2. One connection is enough for a one-off job.
const pool = new Pool({ ...result.data, max: 1 });

try {
  // @concept: idempotency
  // 3. Run every migration that has not run yet. Drizzle remembers the finished ones in the
  //    database, so running this twice is safe. The folder path is relative to the working directory (/app).
  await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  console.log("migrations applied");
} catch (err) {
  // 4. Exit with a non-zero code so Docker Compose knows the migration failed.
  console.error("migration failed:", err);
  process.exitCode = 1;
} finally {
  // 5. Close the connection, otherwise Node would wait for it and never exit.
  await pool.end();
}

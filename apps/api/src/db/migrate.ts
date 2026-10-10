import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { z } from "zod";

// Applies the SQL files in ./drizzle to the database, then exits.
// In Docker it runs as a separate one-off container (`node dist/migrate.js`), NOT inside
// the API: with several API containers starting together, they would all migrate at once.
// It is NOT built on drizzle-kit, because drizzle-kit is a dev tool that is not in the production image.

// 1. This script needs only the database URL, so it validates only that
//    (config/env.ts would also demand PORT, REDIS_URL, ... which a migration does not use).
const result = z.object({ DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }) }).safeParse(process.env);
if (!result.success) {
  console.error("Invalid environment variables:", z.flattenError(result.error).fieldErrors);
  process.exit(1);
}

// 2. One connection is enough for a one-off job.
const pool = new Pool({ connectionString: result.data.DATABASE_URL, max: 1 });

try {
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

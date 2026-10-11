import { defineConfig } from "drizzle-kit";
import { env } from "./src/config/env";

// Settings for drizzle-kit (the CLI behind `pnpm db:generate` and `pnpm db:migrate`).

// drizzle-kit is a local tool (laptop and CI), so it always uses DATABASE_URL, never the AWS DB_* pieces.
const url = env.database.connectionString;
if (!url) throw new Error("drizzle-kit needs DATABASE_URL (see apps/api/.env.example)");

export default defineConfig({
  dialect: "postgresql",
  // 1. Where our table definitions live. `generate` compares these to past migrations.
  schema: "./src/db/schema",
  // 2. Where the generated SQL migration files go. These ARE committed to git.
  out: "./drizzle",
  // 3. The database `migrate` runs against (validated by config/env.ts).
  dbCredentials: { url },
});

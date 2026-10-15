import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { SEED_EVENTS } from "../../apps/api/src/db/seed-events.ts";
import { ROOT } from "./env-files.ts";
import { isPortOpen, redisCommand } from "./net.ts";
import type { CheckResult } from "./results.ts";

// @concept: health-checks
// Checks the data stores the api uses, the way the api uses them: Postgres (can we log in, are all
// migrations applied, are the sample events there) and Redis (does it answer PING). Like the api's
// /ready check, but for your laptop, and every failure says how to fix it.

// 1. `pg` is a dependency of apps/api, not of the repo root: createRequire loads it FROM apps/api
//    (same trick as scripts/booking-race-demo.ts). The types describe only the calls made here.
type PgClient = {
  connect(): Promise<void>;
  query<Row>(text: string, values?: unknown[]): Promise<{ rows: Row[] }>;
  end(): Promise<void>;
};
type PgModule = { Client: new (config: { connectionString: string; connectionTimeoutMillis: number }) => PgClient };

const MIGRATE = "pnpm --filter @minitickets/api db:migrate";
const SEED = "pnpm --filter @minitickets/api db:seed";

// 2. Which migrations are not applied yet. Drizzle lists every migration in its journal
//    (apps/api/drizzle/meta/_journal.json), and records each applied one in Postgres with the
//    journal's "when" as created_at. Pure, so it is unit tested.
export type JournalEntry = { tag: string; when: number };

export function pendingMigrations(journal: JournalEntry[], appliedCreatedAt: number[]): string[] {
  const applied = new Set(appliedCreatedAt);
  return journal.filter((entry) => !applied.has(entry.when)).map((entry) => entry.tag);
}

function readJournal(): JournalEntry[] {
  const file = path.join(ROOT, "apps/api/drizzle/meta/_journal.json");
  return (JSON.parse(readFileSync(file, "utf8")) as { entries: JournalEntry[] }).entries;
}

// 3. Postgres: reachable, login works, migrations, sample events.
export async function checkPostgres(databaseUrl: string | undefined): Promise<CheckResult[]> {
  if (!databaseUrl) return [{ status: "warn", title: "postgres: skipped (no DATABASE_URL in apps/api/.env)" }];
  const url = new URL(databaseUrl);
  const where = `${url.hostname}:${url.port || "5432"}`;
  if (!(await isPortOpen(url.hostname, Number(url.port || "5432")))) {
    return [{ status: "fail", title: `postgres: nothing listens on ${where}`, fix: ["pnpm db:up"] }];
  }

  const requireFromApi = createRequire(path.join(ROOT, "apps/api/package.json"));
  const { Client } = requireFromApi("pg") as PgModule;
  const client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 3000 });
  try {
    // 3a. Log in. A wrong user or password fails HERE, with Postgres' own message (it names the
    //     user, never the password).
    try {
      await client.connect();
    } catch (err) {
      return [{
        status: "fail",
        title: `postgres: cannot log in on ${where}: ${err instanceof Error ? err.message : String(err)}`,
        fix: ["make DATABASE_URL in apps/api/.env match POSTGRES_* in .env"],
      }];
    }
    const results: CheckResult[] = [{ status: "ok", title: `postgres answers on ${where}` }];

    // 3b. Migrations. Before the very first migrate the bookkeeping table does not exist yet
    //     (Postgres error 42P01 "undefined table"): then nothing is applied.
    const applied = await client
      .query<{ created_at: string }>("select created_at from drizzle.__drizzle_migrations")
      .then((r) => r.rows.map((row) => Number(row.created_at)))
      .catch((err: { code?: string }) => {
        if (err.code === "42P01" || err.code === "3F000") return [];
        throw err;
      });
    const journal = readJournal();
    const pending = pendingMigrations(journal, applied);
    results.push(
      pending.length === 0
        ? { status: "ok", title: `all ${journal.length} migrations applied` }
        : { status: "fail", title: `${pending.length} migration(s) not applied: ${pending.join(", ")}`, fix: [MIGRATE] },
    );

    // 3c. The sample events (the e2e tests need some of them). Only when the events table exists.
    if (pending.length < journal.length) {
      const found = await client.query<{ id: string }>("select id::text as id from events where id = any($1::uuid[])", [
        SEED_EVENTS.map((event) => event.id),
      ]);
      const foundIds = new Set(found.rows.map((row) => row.id));
      const missing = SEED_EVENTS.filter((event) => !foundIds.has(event.id));
      results.push(
        missing.length === 0
          ? { status: "ok", title: `all ${SEED_EVENTS.length} sample events are there` }
          : {
              status: "fail",
              title: `${missing.length} of ${SEED_EVENTS.length} sample events missing: ${missing.map((event) => event.title).join(", ")}`,
              fix: [SEED],
            },
      );
    }
    return results;
  } finally {
    await client.end().catch(() => {});
  }
}

// 4. Redis: reachable and answers PING with PONG (sessions and the events cache live here).
export async function checkRedis(redisUrl: string | undefined): Promise<CheckResult> {
  if (!redisUrl) return { status: "warn", title: "redis: skipped (no REDIS_URL in apps/api/.env)" };
  const url = new URL(redisUrl);
  const port = Number(url.port || "6379");
  const where = `${url.hostname}:${port}`;
  if (!(await isPortOpen(url.hostname, port))) {
    return { status: "fail", title: `redis: nothing listens on ${where}`, fix: ["pnpm db:up   (and REDIS_URL's port = REDIS_PORT in .env)"] };
  }
  try {
    const answer = await redisCommand(url.hostname, port, ["PING"]);
    if (answer === "+PONG") return { status: "ok", title: `redis answers on ${where}` };
    return { status: "fail", title: `redis on ${where} answered PING with "${answer}"` };
  } catch (err) {
    return { status: "fail", title: `redis on ${where}: ${err instanceof Error ? err.message : String(err)}` };
  }
}

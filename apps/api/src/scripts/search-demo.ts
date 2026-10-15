import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { z } from "zod";
import { SearchEventsOutput, type EventSearchCursor } from "@minitickets/shared";

// 1. A disposable local DB keeps the 10k bulk seed away from the owner's events and bookings.
const localUrl = z.url().refine(value => ["localhost", "127.0.0.1", "[::1]"].includes(new URL(value).hostname));
const settings = z.object({ DATABASE_URL: localUrl, REDIS_URL: localUrl }).parse(process.env);
const databaseName = `p7_demo_${Date.now()}`;
const databaseUrl = new URL(settings.DATABASE_URL); databaseUrl.pathname = `/${databaseName}`;
const redisUrl = new URL(settings.REDIS_URL); redisUrl.pathname = "/15";
const admin = new Pool({ connectionString: settings.DATABASE_URL, max: 1 });
const db = new Pool({ connectionString: databaseUrl.toString(), max: 1 });
const children: ChildProcess[] = [];
let created = false;
async function portFree(port: number) {
  const probe = createServer();
  await new Promise<void>((resolve, reject) => { probe.once("error", reject); probe.listen(port, "127.0.0.1", resolve); });
  await new Promise<void>(resolve => probe.close(() => resolve()));
}
function start(name: string, args: string[], env: NodeJS.ProcessEnv, cwd = process.cwd()) {
  const child = spawn(process.execPath, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
  children.push(child); console.log(`${name} PID ${child.pid}`); // Record immediately; stop only these PIDs.
  let diagnostics = "";
  for (const stream of [child.stdout!, child.stderr!]) stream.on("data", (chunk: Buffer) => { diagnostics = (diagnostics + chunk.toString()).slice(-12000); if (name === "Playwright") process.stdout.write(chunk); });
  return { child, diagnostics: () => diagnostics };
}
async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>(resolve => child.once("exit", () => resolve()));
  child.kill("SIGTERM");
  const fallback = setTimeout(() => child.kill("SIGKILL"), 10_000);
  await exited; clearTimeout(fallback);
}
async function until(check: () => Promise<boolean>, label: string) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) { if (await check()) return; await sleep(200); }
  throw new Error(`timeout: ${label}`);
}
async function finished(process: ReturnType<typeof start>) {
  const code = await new Promise<number | null>(resolve => process.child.once("exit", resolve));
  assert.equal(code, 0, process.diagnostics());
}

try {
  await Promise.all([3101, 4101].map(portFree));
  await admin.query(`CREATE DATABASE "${databaseName}"`); created = true;
  await migrate(drizzle(db), { migrationsFolder: "./drizzle" });
  const appEnv = { ...process.env, DATABASE_URL: databaseUrl.toString(), REDIS_URL: redisUrl.toString(),
    NODE_ENV: "development", HOST: "127.0.0.1", PORT: "4101", WEB_ORIGIN: "http://127.0.0.1:3101",
    NEXT_PUBLIC_API_URL: "http://127.0.0.1:4101", API_INTERNAL_URL: "http://127.0.0.1:4101",
    WEB_INTERNAL_URL: "http://127.0.0.1:3101", REVALIDATE_SECRET: "p7-local-demo-revalidate-secret-32-chars",
    CI: "false", P7_DEMO: "1", E2E_BASE_URL: "http://127.0.0.1:3101" };
  await finished(start("seed", ["--import", "tsx", "src/db/seed.ts"], appEnv));
  // 2. One SQL bulk insert, with 100 tied timestamps per group to exercise the UUID tie-breaker.
  const seedStart = performance.now();
  await db.query(`INSERT INTO events (id, title, venue, starts_at, total_seats, seats_left)
    SELECT ('70000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
      'P7 Demo ' || lpad(i::text, 5, '0'), 'Demo hall',
      '2028-01-01'::timestamptz + (i / 100) * interval '1 minute', 100, 100
    FROM generate_series(1, 10000) i`);
  // Finish bulk-load maintenance so the GIN pending list does not distort planner costs.
  await db.query("VACUUM ANALYZE events");
  console.log(`Bulk seeded 10000 events in ${Math.round(performance.now() - seedStart)} ms`);
  const api = start("API", ["--import", "tsx", "src/server.ts"], appEnv);
  await until(async () => {
    assert.equal(api.child.exitCode, null, api.diagnostics());
    return fetch("http://127.0.0.1:4101/health").then(r => r.ok, () => false);
  }, "API ready");
  let cursor: z.infer<typeof EventSearchCursor> | null = null;
  const ids = new Set<string>(); let pages = 0; const started = performance.now();
  do {
    const input: string = JSON.stringify({ q: "P7 Demo", limit: 100, cursor });
    const response: Response = await fetch(`http://127.0.0.1:4101/trpc/events.search?input=${encodeURIComponent(input)}`);
    assert.equal(response.status, 200);
    const wire = await response.json() as { result: { data: unknown } };
    const page = SearchEventsOutput.parse(wire.result.data);
    for (const item of page.items) { assert(!ids.has(item.id), "duplicate keyset row"); ids.add(item.id); }
    cursor = page.nextCursor; pages++;
  } while (cursor);
  assert.equal(ids.size, 10000);
  console.log(`Keyset traversal: ${ids.size} unique events, ${pages} pages, 0 duplicates, ${Math.round(performance.now() - started)} ms`);
  // 3. A selective substring should use the GIN index on real data (planner chooses the plan).
  const plan = await db.query(`EXPLAIN (ANALYZE, FORMAT JSON) SELECT id FROM events
    WHERE (title || ' ' || venue) ILIKE '%Demo 09999%'`);
  const encodedPlan = JSON.stringify(plan.rows);
  assert(encodedPlan.includes("events_search_trgm_idx"), "selective search did not use trigram index");
  console.log("Selective substring EXPLAIN ANALYZE: events_search_trgm_idx used");
  const web = start("web", ["node_modules/next/dist/bin/next", "dev", "--port", "3101", "--hostname", "127.0.0.1"], appEnv, "../web");
  await until(async () => {
    assert.equal(web.child.exitCode, null, web.diagnostics());
    return fetch(`${appEnv.WEB_ORIGIN}/events`).then(r => r.ok, () => false);
  }, "web ready");
  const tests = start("Playwright", ["node_modules/@playwright/test/cli.js", "test", "e2e/events.spec.ts",
    "e2e/event-search.spec.ts", "--workers=1", "--reporter=line"], appEnv, "../web");
  await finished(tests);
} finally {
  // 4. Stop only recorded child PIDs and drop only our disposable database; no container changes.
  for (const child of [...children].reverse()) await stop(child);
  await db.end();
  if (created) await admin.query(`DROP DATABASE "${databaseName}"`);
  await admin.end();
  console.log("Cleaned own PIDs and disposable P7 database; owner servers and data untouched.");
}

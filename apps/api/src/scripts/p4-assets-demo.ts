import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { z } from "zod";
import { LocalTicketSettings, setupLocalTickets, cleanupLocalTickets } from "../../../worker/src/tickets/local-stack";

// 1. Local-only disposable resources, API :4101 and web :3101. Never stop an existing server
//    or container. All credentials/endpoints come from local settings, never printed here.
const localUrl = z.url().refine(value => ["localhost", "127.0.0.1", "[::1]"].includes(new URL(value).hostname));
const settings = z.object({ DATABASE_URL: localUrl, REDIS_URL: localUrl }).parse(process.env);
const prefix = `p4b-${Date.now()}`;
const databaseName = prefix.replaceAll("-", "_");
const databaseUrl = new URL(settings.DATABASE_URL); databaseUrl.pathname = `/${databaseName}`;
const redisUrl = new URL(settings.REDIS_URL); redisUrl.pathname = "/15";
const local = LocalTicketSettings.parse({ TICKETS_TABLE: `${prefix}-tickets`, TICKETS_BUCKET: `${prefix}-assets`,
  TICKET_SIGNING_SECRET_ID: `${prefix}/signing`, WEB_ORIGIN: "http://127.0.0.1:3101" });
const admin = new Pool({ connectionString: settings.DATABASE_URL, max: 1 });
const db = new Pool({ connectionString: databaseUrl.toString(), max: 1 });
const children: ChildProcess[] = [];
let databaseCreated = false;
let stack: Awaited<ReturnType<typeof setupLocalTickets>> | undefined;
let workerTableCreated = false;

async function portFree(port: number) {
  const probe = createServer();
  await new Promise<void>((resolve, reject) => { probe.once("error", reject); probe.listen(port, "127.0.0.1", resolve); });
  await new Promise<void>(resolve => probe.close(() => resolve()));
}
function start(name: string, args: string[], env: NodeJS.ProcessEnv, cwd = process.cwd()) {
  const child = spawn(process.execPath, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
  children.push(child); console.log(`${name} PID ${child.pid}`); // Record immediately; stop only these PIDs.
  let diagnostics = "";
  for (const stream of [child.stdout!, child.stderr!]) stream.on("data", (chunk: Buffer) => { diagnostics = (diagnostics + chunk.toString()).slice(-5000); });
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
  await admin.query(`CREATE DATABASE "${databaseName}"`); databaseCreated = true;
  await migrate(drizzle(db), { migrationsFolder: "./drizzle" });
  stack = await setupLocalTickets(local, prefix);
  const appEnv = { ...process.env, ...local, DATABASE_URL: databaseUrl.toString(), REDIS_URL: redisUrl.toString(),
    NODE_ENV: "development", HOST: "127.0.0.1", PORT: "4101", WEB_ORIGIN: local.WEB_ORIGIN,
    WEB_INTERNAL_URL: local.WEB_ORIGIN, REVALIDATE_SECRET: "p4b-demo-local-revalidate-secret-32-chars",
    BOOKING_EVENTS_TOPIC_ARN: stack.topicArn, JOBS_QUEUE_URL: stack.email.url, JOBS_DLQ_URL: stack.email.dlq,
    TICKETS_QUEUE_URL: stack.tickets.url, TICKETS_DLQ_URL: stack.tickets.dlq,
    PROCESSED_JOBS_TABLE: `${prefix}-processed-jobs`, MAILER: "log", MAILER_FAIL_MODE: "off",
    AWS_ACCESS_KEY_ID: "local", AWS_SECRET_ACCESS_KEY: "local", AWS_SESSION_TOKEN: "",
    NEXT_PUBLIC_API_URL: "http://127.0.0.1:4101", API_INTERNAL_URL: "http://127.0.0.1:4101",
    CI: "false", P4_E2E: "1", E2E_BASE_URL: local.WEB_ORIGIN };
  // 2. Seed/migrate only the new database. The worker's processed-jobs table is local too.
  await finished(start("seed", ["--import", "tsx", "src/db/seed.ts"], appEnv));
  await finished(start("jobs table", ["--import", "tsx", "src/scripts/create-table.ts"], appEnv, "../worker"));
  workerTableCreated = true;
  start("worker", ["--import", "tsx", "src/local.ts"], appEnv, "../worker");
  const api = start("API", ["--import", "tsx", "src/server.ts"], appEnv);
  await until(async () => {
    assert.equal(api.child.exitCode, null, api.diagnostics());
    return fetch("http://127.0.0.1:4101/health").then(response => response.ok, () => false);
  }, "API ready");
  const web = start("web", ["node_modules/next/dist/bin/next", "dev", "--port", "3101", "--hostname", "127.0.0.1"], appEnv, "../web");
  await until(async () => {
    assert.equal(web.child.exitCode, null, web.diagnostics());
    return fetch(`${local.WEB_ORIGIN}/login`).then(response => response.ok, () => false);
  }, "web ready");
  // 3. Headless assertions, no screenshots. Real S3 PUT/CORS/GET, worker QR generation,
  //    pending→ready UI, download, admin/user authorization and existing booking flows.
  const tests = start("Playwright", ["node_modules/@playwright/test/cli.js", "test", "e2e/ticket-assets.spec.ts",
    "e2e/bookings.spec.ts", "e2e/booking-idempotency.spec.ts", "e2e/admin-events.spec.ts", "--workers=2", "--reporter=line"], appEnv, "../web");
  await finished(tests);
  console.log(tests.diagnostics());
  console.log("P4B: isolated browser checks passed; QR/download, pending recovery, private reads, poster PUT/CORS/publication and upload replay protection");
} finally {
  // 4. Release ONLY resources created here. No container stop/restart, no shared DB reset.
  for (const child of [...children].reverse()) await stop(child);
  await db.end();
  if (databaseCreated) await admin.query(`DROP DATABASE "${databaseName}"`);
  await admin.end();
  if (stack) await cleanupLocalTickets(local, stack, workerTableCreated ? `${prefix}-processed-jobs` : undefined);
  console.log("Cleaned own processes, database, queues/topic, job/ticket tables, bucket and signing secret; local Redis session/cache keys expire by TTL.");
}

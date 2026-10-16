import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { z } from "zod";

// 1. A disposable local DB keeps the security checks away from the owner's events and bookings.
const localUrl = z.url().refine(value => ["localhost", "127.0.0.1", "[::1]"].includes(new URL(value).hostname));
const settings = z.object({ DATABASE_URL: localUrl, REDIS_URL: localUrl }).parse(process.env);
const databaseName = `p10_demo_${Date.now()}`;
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
    CI: "false", P10_DEMO: "1", E2E_PRODUCTION_BUILD: "1", E2E_BASE_URL: "http://127.0.0.1:3101" };
  await finished(start("seed", ["--import", "tsx", "src/db/seed.ts"], appEnv));
  const api = start("API", ["--import", "tsx", "src/server.ts"], appEnv);
  await until(async () => {
    assert.equal(api.child.exitCode, null, api.diagnostics());
    return fetch("http://127.0.0.1:4101/health").then(r => r.ok, () => false);
  }, "API ready");
  const webEnv = { ...appEnv, NODE_ENV: "production" };
  const build = start("web build", ["node_modules/next/dist/bin/next", "build"], webEnv, "../web");
  await finished(build); console.log("Production web build passed");
  const web = start("web", ["node_modules/next/dist/bin/next", "start", "--port", "3101", "--hostname", "127.0.0.1"], webEnv, "../web");
  await until(async () => {
    assert.equal(web.child.exitCode, null, web.diagnostics());
    return fetch(`${appEnv.WEB_ORIGIN}/events`).then(r => r.ok, () => false);
  }, "web ready");
  const tests = start("Playwright", ["node_modules/@playwright/test/cli.js", "test", "e2e/security.spec.ts", "e2e/login.spec.ts", "e2e/logout.spec.ts", "e2e/bookings.spec.ts", "e2e/booking-idempotency.spec.ts", "e2e/cache-headers.spec.ts", "--workers=1", "--reporter=line"], appEnv, "../web");
  await finished(tests);
} finally {
  // 4. Stop only recorded child PIDs and drop only our disposable database; no container changes.
  for (const child of [...children].reverse()) await stop(child);
  await db.end();
  if (created) await admin.query(`DROP DATABASE "${databaseName}"`);
  await admin.end();
  console.log("Cleaned own PIDs and disposable P10 database; owner servers and data untouched.");
}

import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { z } from "zod";

// 1. Use a disposable LOCAL database and a unique Redis namespace. Never reset shared state.
const localUrl = z.url().refine(value => ["localhost", "127.0.0.1", "[::1]"].includes(new URL(value).hostname));
const settings = z.object({ DATABASE_URL: localUrl, REDIS_URL: localUrl }).parse(process.env);
const namespace = `p8-${Date.now()}`;
const databaseName = namespace.replaceAll("-", "_");
const databaseUrl = new URL(settings.DATABASE_URL); databaseUrl.pathname = `/${databaseName}`;
const redisUrl = new URL(settings.REDIS_URL); redisUrl.pathname = "/15";
const admin = new Pool({ connectionString: settings.DATABASE_URL, max: 1 });
const db = new Pool({ connectionString: databaseUrl.toString(), max: 2 });
const children: ChildProcess[] = [];
let created = false;
let stores: { close: () => Promise<void> } | undefined;
const ownRedisKeys = new Set<string>();
async function portFree(port: number) {
  const probe = createServer();
  await new Promise<void>((resolve, reject) => { probe.once("error", reject); probe.listen(port, "127.0.0.1", resolve); });
  await new Promise<void>(resolve => probe.close(() => resolve()));
}
function start(name: string, args: string[], env: NodeJS.ProcessEnv, cwd = process.cwd()) {
  const child = spawn(process.execPath, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
  children.push(child); console.log(`${name} PID ${child.pid}`); // Record immediately; stop only these PIDs.
  let diagnostics = "";
  let transactionCount = 0;
  let pendingLog = "";
  for (const stream of [child.stdout!, child.stderr!]) stream.on("data", (chunk: Buffer) => { pendingLog += chunk.toString();
    const lines = pendingLog.split("\n"); pendingLog = lines.pop() ?? "";
    transactionCount += lines.filter(line => line.includes('"msg":"booking DB transaction"')).length;
    diagnostics = (diagnostics + chunk.toString()).slice(-12000); if (name === "Playwright") process.stdout.write(chunk); });
  return { child, diagnostics: () => diagnostics, transactions: () => transactionCount };
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
  await Promise.all([3101, 4101, 4102].map(portFree));
  await admin.query(`CREATE DATABASE "${databaseName}"`); created = true;
  await migrate(drizzle(db), { migrationsFolder: "./drizzle" });
  const appEnv: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: databaseUrl.toString(), REDIS_URL: redisUrl.toString(),
    NODE_ENV: "development", HOST: "127.0.0.1", PORT: "4101", WEB_ORIGIN: "http://127.0.0.1:3101",
    NEXT_PUBLIC_API_URL: "http://127.0.0.1:4101", API_INTERNAL_URL: "http://127.0.0.1:4101",
    SALE_REDIS_NAMESPACE: namespace, INVENTORY_GATE_ENABLED: "true", LOG_LEVEL: "debug",
    CI: "false", P8_DEMO: "1", P8_API_URL: "http://127.0.0.1:4101", E2E_BASE_URL: "http://127.0.0.1:3101" };
  // Keep this demo independent of SNS/asset setup and the owner's revalidation secret.
  for (const key of ["WEB_INTERNAL_URL", "REVALIDATE_SECRET", "BOOKING_EVENTS_TOPIC_ARN", "TICKETS_TABLE", "TICKETS_BUCKET"]) delete appEnv[key];
  for (const key of Object.keys(process.env)) if (!(key in appEnv)) delete process.env[key];
  Object.assign(process.env, appEnv);
  const { redis } = await import("../redis/client");
  const { pool } = await import("../db/client");
  stores = { close: async () => {
    // Only keys under this demo's unique namespace, plus the sessions created below.
    let cursor = "0";
    do {
      const [next, keys] = await redis.scan(cursor, "MATCH", `${namespace}:*`, "COUNT", 100);
      cursor = next; for (const key of keys) ownRedisKeys.add(key);
    } while (cursor !== "0");
    if (ownRedisKeys.size) await redis.del(...ownRedisKeys);
    await redis.quit(); await pool.end();
  } };
  await until(async () => redis.status === "ready", "Redis ready");
  const inventory = await import("../queries/inventory");
  const { reconcileEvent } = await import("../services/inventory-reconciliation");
  const { takeToken } = await import("../queries/rate-limits");
  const event = async (seats: number) => {
    const id = randomUUID();
    await db.query("INSERT INTO events (id,title,venue,starts_at,total_seats,seats_left) VALUES ($1,'P8 Demo','Demo hall',now()+interval '1 day',$2,$2)", [id, seats]);
    return id;
  };
  const available = async (id: string) => Number(await redis.hget(inventory.inventoryKeys(id)[0], "available"));
  // 2. Real Lua atomicity, duplicate intent handling, refund ownership and reconciliation races.
  const atomicEvent = await event(10); await inventory.initialize(atomicEvent, 10);
  const reservations = await Promise.all(Array.from({ length: 100 }, async (_, i) => {
    const owner = randomUUID(); const intent = `intent-${i}`;
    const result = await inventory.reserve(atomicEvent, intent, owner, 1);
    return { result, intent, owner };
  }));
  assert.equal(reservations.filter(r => r.result === 1).length, 10, "gate must admit exactly the available seats");
  assert.equal(await available(atomicEvent), 0);
  const first = reservations.find(r => r.result === 1)!;
  assert.equal(await inventory.reserve(atomicEvent, first.intent, randomUUID(), 1), 2, "in-flight retry must reach DB");
  await inventory.settle(atomicEvent, first.intent, randomUUID(), true);
  assert.equal(await available(atomicEvent), 0, "another attempt must not refund this reservation");
  await inventory.settle(atomicEvent, first.intent, first.owner, true);
  await inventory.settle(atomicEvent, first.intent, first.owner, true);
  assert.equal(await available(atomicEvent), 1, "refund is at most once");
  const view = (await inventory.snapshot(atomicEvent))!;
  const lateOwner = randomUUID(); await inventory.reserve(atomicEvent, "later", lateOwner, 1);
  assert.equal(await inventory.reconcile(atomicEvent, view, 999), false, "stale reconciliation must not clobber a new debit");
  // Simulate crash lease expiry without waiting 30s; DB has not sold these seats.
  // Include the later reservation explicitly; expire every remaining member in this owned key.
  for (const owner of await redis.zrange(inventory.inventoryKeys(atomicEvent)[1], 0, "-1")) await redis.zadd(inventory.inventoryKeys(atomicEvent)[1], 0, owner);
  await reconcileEvent(atomicEvent); assert.equal(await available(atomicEvent), 10);
  await inventory.settle(atomicEvent, "later", lateOwner, true); assert.equal(await available(atomicEvent), 10);
  const evictedOwner = randomUUID(); await inventory.reserve(atomicEvent, "evicted", evictedOwner, 1);
  await redis.del(inventory.inventoryKeys(atomicEvent)[1]);
  assert.equal(await inventory.reserve(atomicEvent, "after-eviction", randomUUID(), 1), -1);
  await inventory.initialize(atomicEvent, 10);
  await inventory.settle(atomicEvent, "evicted", evictedOwner, true);
  assert.equal(await available(atomicEvent), 10, "old generation refund must not inflate a rebuilt gate");
  console.log("Lua gate: 10/100 admitted, 90 rejected; duplicate bypass, at-most-once refund, stale CAS rejection, expired-lease and partial-eviction recovery passed");
  if (!process.argv.includes("--gate-check-only")) {
    const identity = randomUUID();
    const tokens = await Promise.all(Array.from({ length: 20 }, () => takeToken("login", identity, 2, 1000)));
    assert.equal(tokens.filter(t => t.allowed).length, 2);
    await sleep(1100); assert.equal((await takeToken("login", identity, 2, 1000)).allowed, true);
    console.log("Lua rate limiter: 2/20 admitted atomically; refill after 1100 ms passed");
    await finished(start("seed", ["--import", "tsx", "src/db/seed.ts"], appEnv));
    const enabled = start("API gate", ["--import", "tsx", "src/server.ts"], appEnv);
    const disabled = start("API baseline", ["--import", "tsx", "src/server.ts"], { ...appEnv, PORT: "4102", INVENTORY_GATE_ENABLED: "false" });
    await until(async () => {
      assert.equal(enabled.child.exitCode, null, enabled.diagnostics()); assert.equal(disabled.child.exitCode, null, disabled.diagnostics());
      const responses = await Promise.all([4101, 4102].map(port => fetch(`http://127.0.0.1:${port}/health`).then(r => r.ok, () => false)));
      return responses.every(Boolean);
    }, "APIs ready");
    const cookies: string[] = [];
    for (let i = 0; i < 34; i++) {
      const id = randomUUID(); const sid = randomUUID(); const key = `session:${createHash("sha256").update(sid).digest("hex")}`;
      await db.query("INSERT INTO users (id,email,password_hash) VALUES ($1,$2,'demo-only')", [id, `p8-${id}@example.com`]);
      ownRedisKeys.add(key); await redis.set(key, JSON.stringify({ userId: id, createdAt: new Date().toISOString() }), "EX", 600);
      cookies.push(`sid=${sid}`);
    }
    const book = (port: number, id: string, cookie: string, key = randomUUID()) => fetch(`http://127.0.0.1:${port}/trpc/bookings.create`, {
      method: "POST", headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ eventId: id, quantity: 1, idempotencyKey: key }),
    });
    // 3. Bounded same-event contention, with identical limits/users/workload on both APIs.
    for (const [port, api, label] of [[4102, disabled, "without gate"], [4101, enabled, "with gate"]] as const) {
      const id = await event(16); if (port === 4101) await inventory.initialize(id, 16);
      const before = api.transactions();
      let next = 0; let successes = 0; const times: number[] = []; const started = performance.now();
      await Promise.all(Array.from({ length: 16 }, async () => {
        while (next < 128) {
          const index = next++; const at = performance.now();
          const response = await book(port, id, cookies[index % 32]);
          await response.text(); times.push(performance.now() - at);
          if (response.status === 200) successes++;
          else assert.equal(response.status, 409, `unexpected load status ${response.status}`);
        }
      }));
      const elapsed = performance.now() - started; times.sort((a, b) => a - b);
      const percentile = (p: number) => Math.round(times[Math.ceil(times.length * p) - 1]);
      const [{ rows }] = await Promise.all([db.query("SELECT seats_left, (SELECT coalesce(sum(quantity),0) FROM bookings WHERE event_id=$1) AS booked FROM events WHERE id=$1", [id])]);
      assert.equal(Number(rows[0].seats_left), 0); assert.equal(Number(rows[0].booked), 16); assert.equal(successes, 16);
      await sleep(30); // Let stdout's pipe catch up before counting transaction log lines.
      const tx = api.transactions() - before;
      console.log(`Load ${label}: 128 requests / 32 users / concurrency 16; ${Math.round(128000 / elapsed)} req/s; p50/p95/p99=${percentile(.5)}/${percentile(.95)}/${percentile(.99)} ms; 16 booked, 112 rejected, 0 oversold; DB transactions=${tx}`);
    }
    // Same-key last-seat races must replay even once the gate is empty; limits span API tasks.
    const retryId = await event(1); await inventory.initialize(retryId, 1); const retryKey = randomUUID();
    const copies = await Promise.all([book(4101, retryId, cookies[32], retryKey), book(4101, retryId, cookies[32], retryKey)]);
    assert(copies.every(r => r.status === 200), "concurrent last-seat retry must succeed twice with one booking");
    const saved = await Promise.all(copies.map(r => r.json())) as { result: { data: { id: string } } }[];
    assert.equal(saved[0].result.data.id, saved[1].result.data.id);
    const replay = await book(4101, retryId, cookies[32], retryKey); assert.equal(replay.status, 200);
    assert.equal((await replay.json() as { result: { data: { id: string } } }).result.data.id, saved[0].result.data.id);
    const acrossTasks = await Promise.all(Array.from({ length: 15 }, (_, i) => book(i % 2 ? 4101 : 4102,
      "00000000-0000-4000-8000-000000000008", cookies[33])));
    assert.equal(acrossTasks.filter(r => r.status === 409).length, 10);
    assert.equal(acrossTasks.filter(r => r.status === 429).length, 5);
    console.log("Last seat: concurrent + sold-out replay returned one booking ID; shared 2-task booking bucket admitted 10/15, rejected 5 with 429");
    // 4. Give-back after a real DB/outbox rollback; advisory corruption must not permit overselling.
    const rollbackId = await event(2); await inventory.initialize(rollbackId, 2);
    await db.query("CREATE FUNCTION p8_reject() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'demo outbox failure'; END $$; CREATE TRIGGER p8_reject BEFORE INSERT ON outbox FOR EACH ROW EXECUTE FUNCTION p8_reject()");
    try { assert.equal((await book(4101, rollbackId, cookies[0])).status, 500); }
    finally { await db.query("DROP TRIGGER p8_reject ON outbox; DROP FUNCTION p8_reject()"); }
    assert.equal(await available(rollbackId), 2, "failed transaction must give back inventory");
    const fallbackId = await event(1); await redis.set(inventory.inventoryKeys(fallbackId)[0], "wrong-type", "EX", 600);
    const fallback = await Promise.all(cookies.slice(0, 8).map(cookie => book(4101, fallbackId, cookie)));
    assert.equal(fallback.filter(r => r.status === 200).length, 1);
    assert.equal(fallback.filter(r => r.status === 409).length, 7);
    console.log("Real outbox rollback refunded 1 debit; unavailable gate fell back safely: 1/8 booked, 0 oversold");
    const web = start("web", ["node_modules/next/dist/bin/next", "dev", "--port", "3101", "--hostname", "127.0.0.1"], appEnv, "../web");
    await until(async () => {
      assert.equal(web.child.exitCode, null, web.diagnostics());
      return fetch(`${appEnv.WEB_ORIGIN}/login`).then(r => r.ok, () => false);
    }, "web ready");
    const tests = start("Playwright", ["node_modules/@playwright/test/cli.js", "test", "e2e/login.spec.ts", "e2e/bookings.spec.ts",
      "e2e/booking-idempotency.spec.ts", "e2e/sale-day.spec.ts", "--workers=1", "--reporter=line"], appEnv, "../web");
    await finished(tests);
  }
} finally {
  // 5. Stop recorded children before closing only our stores/database. No owner server/container changes.
  for (const child of [...children].reverse()) await stop(child);
  await stores?.close(); await db.end();
  if (created) await admin.query(`DROP DATABASE "${databaseName}"`);
  await admin.end(); console.log("Cleaned own PIDs, database, Redis namespace and explicitly created sessions.");
}

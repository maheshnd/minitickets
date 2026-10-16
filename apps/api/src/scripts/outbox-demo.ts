// P3: pnpm demo:outbox [--e2e]. Uses a disposable LOCAL database + queue and two API processes.
// Queue downtime is simulated at our own proxy; the owner's containers and servers stay running.
import { CreateQueueCommand, DeleteQueueCommand, GetQueueAttributesCommand, ReceiveMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { CreateTopicCommand, DeleteTopicCommand, SNSClient, SubscribeCommand } from "@aws-sdk/client-sns";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer, request as forward } from "node:http";
import { createServer as portProbe } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";
import { Pool } from "pg";
import { z } from "zod";

// 1. Refuse remote services: this demo creates/deletes ONLY its own local database and queue.
const localUrl = z.url().refine((value) => ["localhost", "127.0.0.1", "::1"].includes(new URL(value).hostname), "local services only");
const settings = z.object({ DATABASE_URL: localUrl, REDIS_URL: localUrl, SNS_ENDPOINT: localUrl.default("http://localhost:5001") }).parse(process.env);
const { values } = parseArgs({ options: { e2e: { type: "boolean", default: false } } });
const databaseName = `minitickets_p3_${Date.now()}`;
const databaseUrl = new URL(settings.DATABASE_URL);
databaseUrl.pathname = `/${databaseName}`;
const redisUrl = new URL(settings.REDIS_URL);
redisUrl.pathname = "/15";
const admin = new Pool({ connectionString: settings.DATABASE_URL, max: 1 });
const db = new Pool({ connectionString: databaseUrl.toString(), max: 2 });
const sqs = new SQSClient({ endpoint: settings.SNS_ENDPOINT, region: "us-east-1", credentials: { accessKeyId: "local", secretAccessKey: "local" }, maxAttempts: 1 });
const sns = new SNSClient({ endpoint: settings.SNS_ENDPOINT, region: "us-east-1", credentials: { accessKeyId: "local", secretAccessKey: "local" }, maxAttempts: 1 });
let topicArn: string | undefined;
const children: ChildProcess[] = [];
const publishCounts = [0, 0];
let queueUrl: string | undefined;
let databaseCreated = false;
let queueUp = false;
let hangFirstSend = true;
let accepted = 0;

// 2. Our proxy returns 503 while "down" and forwards to Moto while "up". The actual SDK,
//    message serialization and emulator are used in both cases. A small delay exposes overlap.
const proxy = createServer(async (req, res) => {
  if (!queueUp) {
    req.resume();
    // 2b. The first call never answers: the real SDK must time out and release its row lock.
    //     Later calls return 503 so the rest of the outage demo stays short.
    if (hangFirstSend) { hangFirstSend = false; return; }
    res.writeHead(503); res.end("queue unavailable"); return;
  }
  await sleep(100);
  const upstream = forward(new URL(req.url ?? "/", settings.SNS_ENDPOINT), { method: req.method, headers: req.headers }, (response) => {
    if (response.statusCode === 200) accepted++;
    res.writeHead(response.statusCode ?? 502, response.headers);
    response.pipe(res);
  });
  upstream.on("error", () => { res.writeHead(502); res.end(); });
  req.pipe(upstream);
});

async function freePort(port: number) {
  const probe = portProbe();
  await new Promise<void>((resolve, reject) => { probe.once("error", reject); probe.listen(port, "127.0.0.1", resolve); });
  await new Promise<void>((resolve) => probe.close(() => resolve()));
}
async function until(check: () => Promise<boolean>, label: string, timeout = 25_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await check()) return; await sleep(100); }
  throw new Error(`timed out: ${label}`);
}
function check(condition: unknown, label: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${label}`);
}

// 3. Record every child PID immediately and stop only those children in finally. Buffer output
//    privately so routine request logs (and signup addresses) do not fill the demo report.
function start(args: string[], env: NodeJS.ProcessEnv, cwd = process.cwd(), instance?: number) {
  const child = spawn(process.execPath, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
  children.push(child);
  console.log(`Started ${instance === undefined ? "test process" : `API ${instance + 1}`} PID ${child.pid}`);
  let lines = "";
  let diagnostics = "";
  child.stdout!.on("data", (chunk: Buffer) => {
    diagnostics = (diagnostics + chunk.toString()).slice(-4000);
    lines += chunk.toString();
    const split = lines.split("\n"); lines = split.pop()!;
    if (instance !== undefined) for (const line of split) {
      if (line.includes('"msg":"outbox message accepted by SNS"')) publishCounts[instance]++;
    }
  });
  child.stderr!.on("data", (chunk: Buffer) => { diagnostics = (diagnostics + chunk.toString()).slice(-4000); });
  child.on("error", (err) => { diagnostics = err.message; });
  return { child, diagnostics: () => diagnostics };
}
async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  child.kill("SIGTERM");
  const fallback = setTimeout(() => child.kill("SIGKILL"), 10_000);
  await exited;
  clearTimeout(fallback);
}
async function mutation(port: number, path: string, input: unknown, cookie?: string) {
  const response = await fetch(`http://127.0.0.1:${port}/trpc/${path}`, {
    method: "POST", headers: { "content-type": "application/json", origin: process.env.WEB_ORIGIN ?? "http://localhost:3000", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(input),
  });
  const body = await response.json() as { result?: { data: { id: string } } };
  return { status: response.status, id: body.result?.data.id, cookie: response.headers.getSetCookie()[0]?.split(";")[0] };
}

let sid: string | undefined;
try {
  await Promise.all([4101, 4102, 19326, ...(values.e2e ? [3101] : [])].map(freePort));
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  databaseCreated = true;
  await migrate(drizzle(db), { migrationsFolder: "./drizzle" });
  queueUrl = (await sqs.send(new CreateQueueCommand({ QueueName: databaseName }))).QueueUrl;
  check(queueUrl, "local queue created");
  await new Promise<void>((resolve) => proxy.listen(19326, "127.0.0.1", resolve));
  topicArn = (await sns.send(new CreateTopicCommand({ Name: databaseName }))).TopicArn;
  const queueArn = (await sqs.send(new GetQueueAttributesCommand({ QueueUrl: queueUrl, AttributeNames: ["QueueArn"] }))).Attributes!.QueueArn;
  await sns.send(new SubscribeCommand({ TopicArn: topicArn, Protocol: "sqs", Endpoint: queueArn, Attributes: { RawMessageDelivery: "true" } }));
  const apiEnv = {
    ...process.env, DATABASE_URL: databaseUrl.toString(), REDIS_URL: redisUrl.toString(), NODE_ENV: "development",
    HOST: "127.0.0.1", WEB_ORIGIN: "http://127.0.0.1:3101", BOOKING_EVENTS_TOPIC_ARN: topicArn!,
    SNS_ENDPOINT: "http://127.0.0.1:19326", AWS_REGION: "us-east-1", AWS_ACCESS_KEY_ID: "local", AWS_SECRET_ACCESS_KEY: "local",
    WEB_INTERNAL_URL: "http://127.0.0.1:3101", REVALIDATE_SECRET: "outbox-demo-local-revalidate-secret", LOG_LEVEL: "info",
  };
  for (const [instance, port] of [4101, 4102].entries()) {
    const api = start(["--import", "tsx", "src/server.ts"], { ...apiEnv, PORT: String(port) }, process.cwd(), instance);
    await until(async () => {
      check(api.child.exitCode === null, `API startup: ${api.diagnostics()}`);
      return fetch(`http://127.0.0.1:${port}/health`).then((r) => r.ok, () => false);
    }, `API ${instance + 1} ready`);
  }

  // 4. Book while the queue is unreachable. A replay must keep one booking AND one outbox row.
  const email = `outbox-${Date.now()}@example.com`;
  check((await mutation(4101, "auth.signup", { email, password: "outbox-demo-password", confirmPassword: "outbox-demo-password" })).status === 200, "signup");
  sid = (await mutation(4101, "auth.login", { email, password: "outbox-demo-password" })).cookie;
  check(sid, "login cookie");
  const { rows: [event] } = await db.query<{ id: string }>("INSERT INTO events (title, venue, starts_at, total_seats, seats_left) VALUES ('Outbox demo', 'Hall', now() + interval '30 days', 30, 30) RETURNING id");
  const input = { eventId: event.id, quantity: 1, idempotencyKey: randomUUID() };
  const booked = await mutation(4101, "bookings.create", input, sid);
  const replay = await mutation(4102, "bookings.create", input, sid);
  check(booked.status === 200 && replay.id === booked.id, "queue-down booking and replay succeed");
  await until(async () => (await db.query("SELECT 1 FROM outbox WHERE attempts > 0 AND sent_at IS NULL")).rows.length === 1, "failed delivery persisted");
  check((await db.query("SELECT 1 FROM outbox")).rows.length === 1, "replay creates no second outbox row");
  check(accepted === 0, "no queue acceptance while down");
  console.log("Queue down (first send silent): booking 200, replay 200, timeout recovered, 1 pending message, 0 accepted");

  // 5. Failure injection: refuse the outbox insert. The real transaction must roll back both
  //    the booking and its seats. The constraint exists only in our disposable demo database.
  await db.query("ALTER TABLE outbox ADD CONSTRAINT demo_reject_insert CHECK (false) NOT VALID");
  try {
    check((await mutation(4101, "bookings.create", { ...input, idempotencyKey: randomUUID() }, sid)).status === 500, "outbox failure rejects booking");
    check((await db.query("SELECT 1 FROM bookings")).rows.length === 1, "no booking without an outbox message");
    check((await db.query("SELECT seats_left FROM events WHERE id = $1", [event.id])).rows[0].seats_left === 29, "failed transaction restores seats");
  } finally { await db.query("ALTER TABLE outbox DROP CONSTRAINT demo_reject_insert"); }
  console.log("Outbox insert failure: 500, 0 extra bookings, 0 seats taken");

  const more = await Promise.all(Array.from({ length: 23 }, (_, n) => mutation(n % 2 ? 4101 : 4102, "bookings.create", { ...input, idempotencyKey: randomUUID() }, sid)));
  check(more.every((result) => result.status === 200), "all queue-down bookings succeed");
  // Restart a relay before recovery: pending messages and their ids must survive process loss.
  await stop(children[0]);
  const restarted = start(["--import", "tsx", "src/server.ts"], { ...apiEnv, PORT: "4101" }, process.cwd(), 0);
  await until(async () => {
    check(restarted.child.exitCode === null, "restarted API stays up");
    return fetch("http://127.0.0.1:4101/health").then((r) => r.ok, () => false);
  }, "restarted API ready");
  queueUp = true;
  await db.query("UPDATE outbox SET available_at = now()");
  await until(async () => (await db.query("SELECT 1 FROM outbox WHERE sent_at IS NOT NULL")).rows.length === 24, "all confirmations sent");
  const messages: { messageId: string }[] = [];
  while (messages.length < accepted) {
    const response = await sqs.send(new ReceiveMessageCommand({ QueueUrl: queueUrl, MaxNumberOfMessages: 10, WaitTimeSeconds: 1 }));
    check(response.Messages?.length, "messages really reached Moto");
    messages.push(...response.Messages.map((message) => JSON.parse(message.Body!) as { messageId: string }));
  }
  check(messages.length === 24 && new Set(messages.map((message) => message.messageId)).size === 24, "exactly one delivery per message in the healthy relay race");
  check(publishCounts.every((count) => count > 0), "both API instances participated");
  console.log(`Queue restored + API restart: 24/24 sent, ${messages.length} received, 0 duplicates; API publishes ${publishCounts.join(" + ")}`);

  // 6. Optional related browser checks share this isolated database, never the owner's servers.
  if (values.e2e) {
    const seed = start(["--import", "tsx", "src/db/seed.ts"], { ...apiEnv, PORT: "4101" });
    const seedExit = await new Promise<number | null>((resolve) => seed.child.once("exit", resolve));
    check(seedExit === 0, `seed succeeded: ${seed.diagnostics()}`);
    const web = start(["node_modules/next/dist/bin/next", "dev", "--port", "3101", "--hostname", "127.0.0.1"], {
      ...apiEnv, NEXT_PUBLIC_API_URL: "http://127.0.0.1:4101", API_INTERNAL_URL: "http://127.0.0.1:4101",
    }, "../web");
    await until(async () => {
      check(web.child.exitCode === null, `web startup: ${web.diagnostics()}`);
      return fetch("http://127.0.0.1:3101/login").then((r) => r.ok, () => false);
    }, "web ready", 50_000);
    const tests = start(["node_modules/@playwright/test/cli.js", "test", "e2e/bookings.spec.ts", "e2e/booking-idempotency.spec.ts"], {
      ...process.env, E2E_BASE_URL: "http://127.0.0.1:3101", CI: "false",
    }, "../web");
    const testExit = await new Promise<number | null>((resolve) => tests.child.once("exit", resolve));
    console.log(tests.diagnostics());
    check(testExit === 0, "related e2e specs pass");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "demo failed");
  process.exitCode = 1;
} finally {
  // 7. Release only resources this run created, including its login session. No container stops.
  if (sid) await mutation(4102, "auth.logout", {}, sid).catch(() => undefined);
  for (const child of [...children].reverse()) await stop(child);
  proxy.closeAllConnections();
  await new Promise<void>((resolve) => proxy.close(() => resolve()));
  await db.end();
  if (queueUrl) await sqs.send(new DeleteQueueCommand({ QueueUrl: queueUrl }));
  if (topicArn) await sns.send(new DeleteTopicCommand({ TopicArn: topicArn }));
  sns.destroy();
  sqs.destroy();
  if (databaseCreated) await admin.query(`DROP DATABASE "${databaseName}"`);
  await admin.end();
  console.log("Cleaned up: own processes, database, queue and login session");
}

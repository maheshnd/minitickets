// `pnpm stack:reset`: puts the local stack back to a clean start, for a demo or a confusing state.
//
// What it WIPES:  the jobs queue and its dead-letter queue (all messages), the processed-jobs table
//                 (all records), the bookings of the sample events.
// What it RESETS: the sample events (seats and dates back to their starting values).
// What it KEEPS:  users, sessions, every other event and its bookings, the Postgres and Redis data.
//
// Steps:
//   1. Tools + env files are fine (else: stop, and print exactly what to fix).
//   2. docker compose up -d --wait: start any container that is not running.
//   3. docker compose restart queue dynamodb aws-local: all keep everything IN MEMORY, so a restart empties
//      them. ElasticMQ also re-reads docker/elasticmq.conf, so the queues are created again from
//      that file (with the dead-letter queue settings) instead of copied here in code.
//      Then `up --wait` again: `restart` itself does not wait until DynamoDB is healthy.
//   4. Apply new migrations.
//   5. db:seed --reset (apps/api/src/db/seed.ts): bookings of the sample events deleted, the
//      events put back. It refuses a database that is not on this machine.
//   6. Create the processed-jobs table and the P4 topic, queues, table, bucket and secret again (DynamoDB Local started empty in step 3).
//   7. Check the result (servers may be running: fine).

import { setupSections, stackSections } from "./stack/checks.ts";
import { readEnvFiles } from "./stack/env-files.ts";
import { count, printSection, printSummary } from "./stack/results.ts";
import { run } from "./stack/run.ts";

console.log("MiniTickets: resetting the local stack");
console.log("  wipes:  all local queues + DLQs, job/ticket tables, QR objects, signing secret, sample bookings");
console.log("  keeps:  users, sessions, other events, Postgres + Redis data");

// 1.
const envs = readEnvFiles();
const setup = setupSections(envs);
if (count(setup, "fail") > 0) {
  setup.forEach(printSection);
  printSummary(setup, "run pnpm stack:reset again");
  process.exit(1);
}

// 2.-6.
run("docker", ["compose", "up", "-d", "--wait"]);
run("docker", ["compose", "restart", "queue", "dynamodb", "aws-local"]);
run("docker", ["compose", "up", "-d", "--wait"]);
run("pnpm", ["--filter", "@minitickets/api", "db:migrate"]);
run("pnpm", ["--filter", "@minitickets/api", "db:seed", "--reset"]);
run("pnpm", ["jobs:table"]);
run("pnpm", ["tickets:setup"]);

// 7.
const stack = await stackSections(envs, "running");
stack.forEach(printSection);
printSummary(stack, "run pnpm stack:reset again");
// The api's events list cache (Redis) and the web app's data cache may show the old seat counts
// for up to ~30 s (their lifetime); the event pages read Postgres and are right at once.
console.log("Note: the events LIST may show the old seat counts for up to ~30 s (cached); event pages are right at once.");
process.exitCode = count(stack, "fail") > 0 ? 1 : 0;

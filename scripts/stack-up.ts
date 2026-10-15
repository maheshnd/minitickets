// `pnpm stack:up`: gets everything under the app ready. `pnpm dev` runs it first, then starts the
// apps (`pnpm dev:apps` starts only the apps, without this).
//
// Every step is safe to repeat ("idempotent"): it only adds what is missing and never deletes
// data. That is why it can run on every `pnpm dev`. (`pnpm stack:reset` is the one that wipes.)
//   1. Tools + env files are fine (else: stop, and print exactly what to fix).
//   2. docker compose up -d --wait: start the containers that are not running and wait until they
//      are healthy. Containers that already run are left alone.
//   3. Apply new migrations.
//   4. Add the sample events that are missing.
//   5. Create the processed-jobs table. DynamoDB Local keeps it IN MEMORY, so it is gone after
//      every start of its container; this step brings it back (it skips what exists).
//   6. Check the result, and that the api and web ports are free for the apps.

import { setupSections, stackSections } from "./stack/checks.ts";
import { readEnvFiles } from "./stack/env-files.ts";
import { count, printSection, printSummary } from "./stack/results.ts";
import { run } from "./stack/run.ts";

const started = Date.now();
console.log("MiniTickets: getting the local stack ready (pnpm dev:apps skips this)");

// 1. Before touching anything.
const envs = readEnvFiles();
const setup = setupSections(envs);
setup.forEach(printSection);
if (count(setup, "fail") > 0) {
  printSummary(setup, "run pnpm dev again");
  process.exit(1);
}

// 2.-5. The setup commands. Each stops the script if it fails.
run("docker", ["compose", "up", "-d", "--wait"]);
run("pnpm", ["--filter", "@minitickets/api", "db:migrate"]);
run("pnpm", ["--filter", "@minitickets/api", "db:seed"]);
run("pnpm", ["jobs:table"]);
run("pnpm", ["tickets:setup"]);

// 6. The containers and their data, and free ports for the apps about to start.
const stack = await stackSections(envs, "starting");
stack.forEach(printSection);
if (count(stack, "fail") > 0) {
  printSummary(stack, "run pnpm dev again");
  process.exit(1);
}
console.log(`\nStack ready in ${((Date.now() - started) / 1000).toFixed(1)} s.\n`);

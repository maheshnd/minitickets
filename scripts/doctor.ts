// `pnpm run doctor`: checks everything the app needs on this laptop and prints exactly what to fix.
// It only LOOKS: it never starts, changes or deletes anything (`pnpm dev` and `pnpm stack:reset`
// are the ones that act). Safe to run any time, also while `pnpm dev` is running.
//
// Always with "run": plain `pnpm doctor` is pnpm's OWN built-in command (it checks pnpm's config),
// and a built-in wins over a script with the same name. It prints nothing when pnpm is fine, which
// looks just like "all good", so the "run" matters.
//
// What it checks, in order (each group in scripts/stack/):
//   1. Tools: Node version, installed packages, Docker running        (tool-checks.ts)
//   2. Env files: the 4 files exist, have every setting of their      (env-checks.ts)
//      .env.example, and agree with each other (never prints a value)
//   3. Containers: postgres, redis, queue, dynamodb running/healthy   (tool-checks.ts)
//   4. Data: Postgres login, migrations, sample events; Redis PING   (data-checks.ts)
//   5. Jobs: queue + dead-letter queue, processed-jobs table          (jobs-checks.ts)
//   6. Dev servers: is our api / web app answering on its port        (port-checks.ts)
// Exit code 1 if anything failed (✗), so other scripts and CI can rely on it.

import { setupSections, stackSections } from "./stack/checks.ts";
import { readEnvFiles } from "./stack/env-files.ts";
import { count, printSection, printSummary } from "./stack/results.ts";
import { checkDocker } from "./stack/tool-checks.ts";

console.log("MiniTickets doctor (only looks, changes nothing)");

const envs = readEnvFiles();
const sections = setupSections(envs);
sections.forEach(printSection);

// The second half needs Docker; without it every check there would just repeat "not running".
if (checkDocker().status === "ok") {
  const more = await stackSections(envs, "running");
  more.forEach(printSection);
  sections.push(...more);
}

printSummary(sections, "check again with: pnpm run doctor");
process.exitCode = count(sections, "fail") > 0 ? 1 : 0;

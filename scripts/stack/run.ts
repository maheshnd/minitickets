import { spawnSync } from "node:child_process";
import { ROOT } from "./env-files.ts";

// Runs one setup command in the repo root, with its output shown as it happens. If it fails, the
// whole script stops right there (the next steps depend on it).
export function run(command: string, args: string[]) {
  console.log(`\n-> ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, { cwd: ROOT, stdio: "inherit" });
  if (result.status !== 0) {
    console.error(`\n✗ "${command} ${args.join(" ")}" failed. Fix what it printed above; pnpm run doctor shows what is wrong.`);
    process.exit(result.status ?? 1);
  }
}

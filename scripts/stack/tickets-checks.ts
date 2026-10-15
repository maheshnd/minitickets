import { spawnSync } from "node:child_process";
import { ROOT } from "./env-files.ts";
import type { CheckResult } from "./results.ts";

// 1. Keep SDK dependencies in the worker package. Its read-only check refuses remote endpoints.
export function checkTicketPipeline(): CheckResult {
  const result = spawnSync("pnpm", ["--filter", "@minitickets/worker", "tickets:check"], {
    cwd: ROOT, encoding: "utf8", timeout: 30_000,
  });
  return result.status === 0
    ? { status: "ok", title: "P4: SNS fan-out, ticket queue/DLQ, table/GSI, private bucket and signing secret" }
    : { status: "fail", title: "P4 ticket pipeline is not ready", fix: ["compare apps/api/.env and apps/worker/.env with their .env.example files", "pnpm tickets:setup"] };
}

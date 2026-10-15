import { checkPostgres, checkRedis } from "./data-checks.ts";
import { envChecks } from "./env-checks.ts";
import type { EnvFile, EnvFileKey } from "./env-files.ts";
import { checkProcessedJobsTable, checkQueues } from "./jobs-checks.ts";
import { checkPort, type PortMode } from "./port-checks.ts";
import type { Section } from "./results.ts";
import { checkContainers, checkDocker, checkNode, checkPackages } from "./tool-checks.ts";

// The checks, grouped and in order. Two halves, because `pnpm dev` (stack-up.ts) needs a gap
// between them: the first half must pass BEFORE it starts the containers, the second half checks
// what the containers hold AFTER it started them.

type EnvFiles = Record<EnvFileKey, EnvFile>;

// 1. First half: no container needed. Tools, then the env files (docker compose itself reads .env).
export function setupSections(envs: EnvFiles): Section[] {
  return [
    { name: "Tools", results: [checkNode(), checkPackages(), checkDocker()] },
    { name: "Env files", results: envChecks(envs, process.env) },
  ];
}

// 2. Second half: the containers and what is inside them, then the dev-server ports.
export async function stackSections(envs: EnvFiles, portMode: PortMode): Promise<Section[]> {
  const api = envs.api.values ?? {};
  const worker = envs.worker.values ?? {};
  // 2a. The web app's port: where browsers open it (WEB_ORIGIN), 3000 when that is unset or invalid.
  const webPort = URL.canParse(api.WEB_ORIGIN ?? "") ? Number(new URL(api.WEB_ORIGIN).port || "80") : 3000;
  return [
    { name: "Containers (docker-compose.yml)", results: checkContainers() },
    { name: "Data (Postgres, Redis)", results: [...(await checkPostgres(api.DATABASE_URL)), await checkRedis(api.REDIS_URL)] },
    { name: "Jobs (queue, dead-letter queue, processed-jobs table)", results: [...(await checkQueues(worker, api)), await checkProcessedJobsTable(worker)] },
    {
      name: "Dev servers",
      results: [await checkPort("api", Number(api.PORT ?? "4000"), portMode), await checkPort("web", webPort, portMode)],
    },
  ];
}

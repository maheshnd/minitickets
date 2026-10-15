import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { ROOT } from "./env-files.ts";
import type { CheckResult } from "./results.ts";

// Checks the tools under the app: Node, the installed packages, Docker and our containers.

// 1. Node: the version in .nvmrc (what CI and the Docker images use). Another major version
//    usually works, so this is only a warning.
export function checkNode(): CheckResult {
  const wanted = readFileSync(path.join(ROOT, ".nvmrc"), "utf8").trim();
  const running = process.versions.node;
  if (running.split(".")[0] === wanted.split(".")[0]) return { status: "ok", title: `node ${running} (.nvmrc: ${wanted})` };
  return { status: "warn", title: `node ${running}, but .nvmrc says ${wanted}`, fix: [`nvm use   (or install Node ${wanted})`] };
}

// 2. Packages: every dependency of every workspace package is installed, and the install matches
//    the lockfile. pnpm keeps a copy of the lockfile it installed from in node_modules/.pnpm/;
//    when pnpm-lock.yaml changed since (a pull that added a package), the two differ.
const PACKAGE_DIRS = [".", "apps/api", "apps/web", "apps/worker", "packages/shared"];

export function checkPackages(): CheckResult {
  const missing: string[] = [];
  for (const dir of PACKAGE_DIRS) {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, dir, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    for (const name of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) {
      if (!existsSync(path.join(ROOT, dir, "node_modules", name, "package.json"))) missing.push(`${dir}: ${name}`);
    }
  }
  if (missing.length > 0) {
    return { status: "fail", title: `${missing.length} package(s) not installed`, detail: missing.slice(0, 5), fix: ["pnpm install"] };
  }
  const installed = path.join(ROOT, "node_modules/.pnpm/lock.yaml");
  if (existsSync(installed) && readFileSync(installed, "utf8") !== readFileSync(path.join(ROOT, "pnpm-lock.yaml"), "utf8")) {
    return { status: "warn", title: "pnpm-lock.yaml changed since the last install", fix: ["pnpm install"] };
  }
  return { status: "ok", title: "packages installed (match pnpm-lock.yaml)" };
}

// 3. Docker: `docker info` only answers when the Docker engine is running.
export function checkDocker(): CheckResult {
  const result = spawnSync("docker", ["info", "--format", "{{.ServerVersion}}"], { encoding: "utf8" });
  if (result.status === 0) return { status: "ok", title: `docker is running (engine ${result.stdout.trim()})` };
  return {
    status: "fail",
    title: result.error ? "docker is not installed" : "docker is not running",
    fix: ["start Docker Desktop, then run this again"],
  };
}

// 4. Our containers (docker-compose.yml, without the "app" profile). Each must be running, and
//    healthy when it has a healthcheck (queue has none: its image has no shell tools).
//    DynamoDB Local keeps everything in memory, so a container that was (re)started has NO table:
//    `pnpm jobs:table` (also run by `pnpm dev`) creates it again.
export const SERVICES = ["postgres", "redis", "queue", "dynamodb"] as const;

type ComposeContainer = { Service: string; State: string; Health: string };

export function checkContainers(): CheckResult[] {
  // 4a. `--all` also lists stopped containers; `--format json` prints one JSON object per line.
  const result = spawnSync("docker", ["compose", "ps", "--all", "--format", "json"], { cwd: ROOT, encoding: "utf8" });
  if (result.status !== 0) {
    return [{ status: "fail", title: "cannot list the containers (docker compose ps failed)", detail: [result.stderr.trim().split("\n").at(-1) ?? ""] }];
  }
  const containers = result.stdout
    .split("\n")
    .filter((line) => line.trim().startsWith("{"))
    .map((line) => JSON.parse(line) as ComposeContainer);

  return SERVICES.map((service): CheckResult => {
    const container = containers.find((c) => c.Service === service);
    if (!container) return { status: "fail", title: `${service}: no container`, fix: ["pnpm db:up"] };
    if (container.State !== "running") return { status: "fail", title: `${service}: ${container.State}`, fix: ["pnpm db:up"] };
    if (container.Health && container.Health !== "healthy") {
      return { status: "fail", title: `${service}: running but ${container.Health}`, fix: ["wait a few seconds and run this again; still not healthy: docker compose logs " + service] };
    }
    return { status: "ok", title: `${service}: running${container.Health ? ", healthy" : ""}` };
  });
}

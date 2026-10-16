import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cp, mkdtemp, rm, stat, symlink } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const root = path.resolve(import.meta.dirname, "..");
const webDir = path.join(root, "apps/web");
const apiDir = path.join(root, "apps/api");
const webUrl = "http://localhost:3100";
const apiUrl = "http://localhost:4100";
type Running = { name: string; child: ChildProcess; done: Promise<number> };
const children: Running[] = [];
const controller = new AbortController();
let buildDir: string | undefined;

// 1. Refuse occupied ports. Never reuse, stop or restart an existing process.
async function portFree(port: number) {
  const probe = createServer();
  try {
    await new Promise<void>((resolve, reject) => {
      probe.once("error", reject);
      probe.listen({ port, host: "::", ipv6Only: false }, resolve);
    });
  } catch {
    throw new Error(`Port ${port} is unavailable; leave its process alone and free it before retrying.`);
  } finally {
    if (probe.listening) await new Promise<void>(resolve => probe.close(() => resolve()));
  }
}

// 2. Spawn the actual Node process (no shell/pnpm server wrappers) and record its PID immediately.
function start(name: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): Running {
  controller.signal.throwIfAborted();
  const child = spawn(process.execPath, args, { cwd, env,
    stdio: name === "API" ? ["ignore", "pipe", "pipe"] : "inherit" });
  console.log(`${name} PID ${child.pid}`);
  let diagnostics = "";
  for (const stream of [child.stdout, child.stderr]) stream?.on("data", (chunk: Buffer) => {
    diagnostics = (diagnostics + chunk.toString()).slice(-8000);
  });
  const done = new Promise<number>(resolve => {
    child.once("error", error => { console.error(`${name}: ${error.message}`); resolve(1); });
    child.once("exit", code => {
      if (code && diagnostics) console.error(diagnostics);
      resolve(code ?? 1);
    });
  });
  const running = { name, child, done };
  children.push(running);
  return running;
}

// 3. Signals interrupt the current phase, then the same finally block cleans up our children.
const interrupted = new Promise<never>((_, reject) => {
  controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true });
});
void interrupted.catch(() => {});
const interrupt = (signal: NodeJS.Signals) => {
  process.exitCode = signal === "SIGINT" ? 130 : 143;
  controller.abort(new Error(`Interrupted by ${signal}`));
};
process.on("SIGINT", interrupt);
process.on("SIGTERM", interrupt);

async function finished(running: Running) {
  const code = await Promise.race([running.done, interrupted]);
  if (code !== 0) throw new Error(`${running.name} exited with code ${code}`);
}
async function ready(url: string, running: Running) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    controller.signal.throwIfAborted();
    if (running.child.exitCode !== null || running.child.signalCode !== null) {
      throw new Error(`${running.name} exited before becoming ready`);
    }
    const responds = await fetch(url, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(2000)]) })
      .then(async response => { await response.text(); return response.ok; }, () => false);
    if (responds) return;
    await sleep(200, undefined, { signal: controller.signal });
  }
  throw new Error(`Timed out waiting for ${running.name} at ${url}`);
}
async function stop({ name, child, done }: Running) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  console.log(`Stopping ${name} PID ${child.pid}`);
  child.kill("SIGTERM");
  const fallback = setTimeout(() => child.kill("SIGKILL"), 10_000);
  try { await done; } finally { clearTimeout(fallback); }
}

try {
  await Promise.all([3100, 4100].map(portFree));
  // 4. Copy only web sources. Keeping the copy beside apps/web preserves relative config paths;
  //    dependencies stay inside the repo's Turbopack root. The owner's .next/types stay untouched.
  buildDir = await mkdtemp(path.join(root, "apps/.e2e-prod-"));
  const ignored = new Set(["node_modules", ".next", "next-env.d.ts", "tsconfig.tsbuildinfo", "test-results", "playwright-report"]);
  await cp(webDir, buildDir, { recursive: true,
    filter: source => !ignored.has(path.basename(source)) && !path.basename(source).startsWith(".env") });
  await symlink(path.join(webDir, "node_modules"), path.join(buildDir, "node_modules"), "dir");

  // 5. Both browser and server requests use our API. The API keeps local HTTP cookies working.
  //    This uses the existing local DB/Redis (the suite creates accounts/events and books seats).
  const env: NodeJS.ProcessEnv = { ...process.env, NEXT_PUBLIC_API_URL: apiUrl, API_INTERNAL_URL: apiUrl,
    WEB_ORIGIN: webUrl, WEB_INTERNAL_URL: webUrl, HOST: "127.0.0.1", PORT: "4100", TRUST_PROXY_HOPS: "0",
    REVALIDATE_SECRET: randomUUID() + randomUUID(), SALE_REDIS_NAMESPACE: `e2e-prod-${process.pid}`,
    E2E_PRODUCTION_BUILD: "1", E2E_BASE_URL: webUrl, E2E_LOCAL_API: "1" };
  const production = { ...env, NODE_ENV: "production" };
  await finished(start("Web build", ["node_modules/next/dist/bin/next", "build"], buildDir, production));
  // 6. Match the Docker image: standalone keeps the monorepo layout and omits static/public files.
  const standaloneDir = path.join(buildDir, ".next/standalone/apps", path.basename(buildDir));
  await cp(path.join(buildDir, ".next/static"), path.join(standaloneDir, ".next/static"), { recursive: true });
  const publicDir = path.join(buildDir, "public");
  if (await stat(publicDir).then(() => true, error => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  })) await cp(publicDir, path.join(standaloneDir, "public"), { recursive: true });
  const api = start("API", ["--import", "tsx", "src/server.ts"], apiDir, { ...env, NODE_ENV: "development" });
  await ready(`${apiUrl}/ready`, api);
  const web = start("Web", ["server.js"], standaloneDir, { ...production, HOSTNAME: "127.0.0.1", PORT: "3100" });
  await ready(`${webUrl}/events`, web);
  // 7. No spec filter: run the full suite, preserving its explicit demo-only skips.
  await finished(start("Playwright", ["node_modules/@playwright/test/cli.js", "test", "--workers=1", ...process.argv.slice(2)], webDir, env));
} catch (error) {
  console.error(error instanceof Error ? error.message : "Production e2e run failed");
  process.exitCode ||= 1;
} finally {
  // 8. Success, failure and Ctrl+C all stop only our recorded PIDs. Never signal a process group.
  for (const child of [...children].reverse()) await stop(child);
  if (buildDir) await rm(buildDir, { recursive: true, force: true });
  process.off("SIGINT", interrupt);
  process.off("SIGTERM", interrupt);
}

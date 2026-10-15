import { spawnSync } from "node:child_process";
import { isPortOpen } from "./net.ts";
import type { CheckResult } from "./results.ts";

// Checks the two dev-server ports: the api (PORT, default 4000) and the web app (the port in
// WEB_ORIGIN, default 3000). Each port is one of:
//   free  = nothing listens there,
//   ours  = our api / web app answers there,
//   other = some other program holds it (pnpm dev would fail with "address already in use").

export type PortState = "free" | "ours" | "other";

// 1. What the check means depends on WHEN it runs:
//    "running"  (pnpm stack:check):  ours is good; free means "not started" (the e2e tests need both);
//    "starting" (pnpm dev):      free is good; ours means a second pnpm dev, which would crash.
export type PortMode = "running" | "starting";

// 2. The result for one port. Pure, so it is unit tested.
export function portResult(app: "api" | "web", port: number, state: PortState, mode: PortMode, holder = ""): CheckResult {
  if (state === "other") {
    return {
      status: "fail",
      title: `${app}: something else listens on :${port}${holder ? ` (${holder})` : ""}`,
      fix: [`stop that program, or see who it is: lsof -nP -iTCP:${port} -sTCP:LISTEN`],
    };
  }
  if (mode === "running") {
    return state === "ours"
      ? { status: "ok", title: `${app} answers on :${port}` }
      : { status: "warn", title: `${app} is not running on :${port}`, fix: ["pnpm dev   (the e2e tests need the api and the web app running)"] };
  }
  return state === "free"
    ? { status: "ok", title: `:${port} is free for the ${app}` }
    : {
        status: "fail",
        title: `the ${app} is already running on :${port} (a second pnpm dev?)`,
        fix: ["stop the other one first (Ctrl+C in its terminal). To check a running stack: pnpm stack:check"],
      };
}

// 3. Is it ours? The api answers GET /health with {"status":"ok"}; the web app's pages have the
//    title "MiniTickets". The web dev server may compile the page first, so it gets more time.
async function isOurs(app: "api" | "web", port: number): Promise<boolean> {
  try {
    if (app === "api") {
      const response = await fetch(`http://localhost:${port}/health`, { signal: AbortSignal.timeout(3000) });
      return response.ok && ((await response.json()) as { status?: string }).status === "ok";
    }
    const response = await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(20_000) });
    return (await response.text()).includes("<title>MiniTickets");
  } catch {
    return false;
  }
}

// 4. Who holds a port: `lsof` lists the listening program (read only). Its 2nd line is
//    "COMMAND PID USER ...". Not every system has lsof; then we just say less.
function holderOf(port: number): string {
  const result = spawnSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" });
  const [command, pid] = (result.stdout ?? "").split("\n")[1]?.split(/\s+/) ?? [];
  return command && pid ? `${command}, pid ${pid}` : "";
}

export async function checkPort(app: "api" | "web", port: number, mode: PortMode): Promise<CheckResult> {
  if (!(await isPortOpen("localhost", port))) return portResult(app, port, "free", mode);
  if (await isOurs(app, port)) return portResult(app, port, "ours", mode);
  return portResult(app, port, "other", mode, holderOf(port));
}

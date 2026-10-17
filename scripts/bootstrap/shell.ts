import { spawnSync } from "node:child_process";
import path from "node:path";

// Runs the CLIs the bootstrap talks to (aws, pulumi, gh, dig, git). No library for any of them on
// purpose: these are the same commands you would type, so every step can be repeated by hand.

export const ROOT = path.resolve(import.meta.dirname, "../..");
export const INFRA = path.join(ROOT, "infra");

export type Result = { ok: boolean; code: number; stdout: string; stderr: string };

export type RunOptions = {
  cwd?: string;
  env?: Record<string, string>;
  // Text for the command's standard input. Secrets go HERE, never into the arguments: arguments
  // are visible to every process on the laptop (`ps`) and end up in shell history.
  input?: string;
};

// 1. Run and CAPTURE the output (nothing is printed). For reads and checks.
export function capture(command: string, args: string[], options: RunOptions = {}): Result {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? ROOT,
    env: { ...process.env, ...options.env },
    input: options.input,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) {
    return { ok: false, code: 127, stdout: "", stderr: `${command}: ${result.error.message}` };
  }
  return { ok: result.status === 0, code: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
}

// 2. Run with the output shown LIVE (for `pulumi up`, which takes minutes and asks nothing: --yes).
export function stream(command: string, args: string[], options: RunOptions = {}): number {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? ROOT,
    env: { ...process.env, ...options.env },
    stdio: "inherit",
  });
  return result.status ?? 1;
}

// 3. Parse JSON output, or undefined if the command failed or printed something else.
export function json<T>(result: Result): T | undefined {
  if (!result.ok) return undefined;
  try {
    return JSON.parse(result.stdout) as T;
  } catch {
    return undefined;
  }
}

// 4. The first useful line of an error, for a short message.
export function firstError(result: Result): string {
  const text = `${result.stderr}\n${result.stdout}`;
  return text.split("\n").map((line) => line.trim()).find((line) => line.length > 0) ?? `exit code ${result.code}`;
}

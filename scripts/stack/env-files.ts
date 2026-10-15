import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";

// Reads the four local env files and their committed examples. Never prints a value: the checks
// that use these values (env-checks.ts) only compare them.

export const ROOT = path.resolve(import.meta.dirname, "../..");

// 1. Each env file, its example, and who reads it. The example is the contract: every setting in
//    it (every line that is not a comment) should be in the real file.
export const ENV_FILES = [
  { key: "root", file: ".env", example: ".env.example", readBy: "docker-compose.yml" },
  { key: "api", file: "apps/api/.env", example: "apps/api/.env.example", readBy: "the api" },
  { key: "web", file: "apps/web/.env.local", example: "apps/web/.env.example", readBy: "the web app" },
  { key: "worker", file: "apps/worker/.env", example: "apps/worker/.env.example", readBy: "the worker" },
] as const;

export type EnvFileKey = (typeof ENV_FILES)[number]["key"];
export type EnvValues = Record<string, string>;

// 2. What we know about one env file: its parsed values (undefined = the file does not exist) and
//    the example's settings, each with its exact line (to print as the fix).
export type EnvFile = {
  key: EnvFileKey;
  file: string;
  example: string;
  readBy: string;
  values: EnvValues | undefined;
  exampleLines: Map<string, string>;
};

// 3. The example's settings: "KEY=value" lines, in file order. Comment lines ("# KEY=value") are
//    optional settings, so they are not part of the contract.
export function exampleLines(exampleText: string): Map<string, string> {
  const lines = new Map<string, string>();
  for (const line of exampleText.split("\n")) {
    const match = /^([A-Z_][A-Z0-9_]*)=/.exec(line.trim());
    if (match) lines.set(match[1], line.trim());
  }
  return lines;
}

// 4. Read all four. parseEnv is Node's own parser, the same one `node --env-file` / `tsx
//    --env-file` use when the apps start, so we see exactly what they will see.
export function readEnvFiles(): Record<EnvFileKey, EnvFile> {
  const result = {} as Record<EnvFileKey, EnvFile>;
  for (const entry of ENV_FILES) {
    const filePath = path.join(ROOT, entry.file);
    const examplePath = path.join(ROOT, entry.example);
    result[entry.key] = {
      ...entry,
      values: existsSync(filePath) ? (parseEnv(readFileSync(filePath, "utf8")) as EnvValues) : undefined,
      exampleLines: existsSync(examplePath) ? exampleLines(readFileSync(examplePath, "utf8")) : new Map(),
    };
  }
  return result;
}

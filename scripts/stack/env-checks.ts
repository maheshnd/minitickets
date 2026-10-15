import type { EnvFile, EnvFileKey, EnvValues } from "./env-files.ts";
import type { CheckResult } from "./results.ts";

// @concept: twelve-factor-config
// Checks the four local env files: each one exists, has every setting its .env.example has, and
// the files agree with each other. Pure functions (no file or network access), so they are unit
// tested in env-checks.test.ts. RULE: a value is never printed, only compared. The fix lines are
// copied from the .env.example files, which hold no secrets.

type EnvFiles = Record<EnvFileKey, EnvFile>;

const SECRET = "REVALIDATE_SECRET";
const MIN_SECRET_LENGTH = 32; // the same minimum as RevalidateSecretSchema (packages/shared)

// 1. Why some settings matter, printed next to a missing one (so a missing line is not a mystery).
const WHY: Record<string, string> = {
  WEB_INTERNAL_URL: "the revalidate hook (with REVALIDATE_SECRET): without it the 2 admin e2e tests fail",
  JOBS_QUEUE_URL: "without it the local email worker cannot read confirmations",
  JOBS_DLQ_URL: "used by pnpm jobs:dlq and pnpm jobs:redrive",
  DYNAMODB_ENDPOINT: "without it the worker would call REAL AWS DynamoDB instead of the local container",
  BOOKING_EVENTS_TOPIC_ARN: "without it the API outbox relay waits instead of publishing",
  SNS_ENDPOINT: "local SNS must use Moto, matching the worker SQS endpoint",
  SQS_ENDPOINT: "without it the SDK would call REAL AWS SQS instead of the local queue container",
};

// 2. One file: it exists, and no setting of its example is missing. REVALIDATE_SECRET is left to
//    checkRevalidateSecret below, because it needs a made-up value, not the example's line.
export function checkEnvFile(env: EnvFile): CheckResult {
  if (env.values === undefined) {
    return {
      status: "fail",
      title: `${env.file} is missing (read by ${env.readBy})`,
      fix: [`cp ${env.example} ${env.file}`],
    };
  }
  const values = env.values;
  const missing = [...env.exampleLines.keys()].filter((key) => key !== SECRET && !(key in values));
  if (missing.length === 0) return { status: "ok", title: env.file };
  return {
    status: "fail",
    title: `${env.file}: ${missing.length} setting${missing.length === 1 ? "" : "s"} missing: ${missing.join(", ")}`,
    detail: missing.filter((key) => key in WHY).map((key) => `${key}: ${WHY[key]}`),
    fix: [`add these lines to ${env.file} (from ${env.example}):`, ...missing.map((key) => `  ${env.exampleLines.get(key)}`)],
  };
}

// 3. The revalidate secret: the api sends it, the web app checks it, so both need the SAME value
//    of 32+ characters ("CHANGE-ME" from the example is too short on purpose). The root .env has
//    its own copy for `pnpm app:up` (compose passes one value to both containers).
export function checkRevalidateSecret(envs: EnvFiles): CheckResult {
  // 3a. Only once every file that needs it exists (else the fix would write into a missing file).
  if (Object.values(envs).some((env) => env.values === undefined && env.exampleLines.has(SECRET))) {
    return { status: "warn", title: `${SECRET}: skipped until the missing env files exist` };
  }
  const needIt = Object.values(envs).filter((env) => env.values !== undefined && env.exampleLines.has(SECRET));
  const missing = needIt.filter((env) => !(SECRET in env.values!));
  const tooShort = needIt.filter((env) => SECRET in env.values! && env.values![SECRET].length < MIN_SECRET_LENGTH);

  if (missing.length > 0 || tooShort.length > 0) {
    return {
      status: "fail",
      title: `${SECRET}: ${[
        missing.length > 0 ? `missing in ${missing.map((env) => env.file).join(", ")}` : "",
        tooShort.length > 0 ? `shorter than ${MIN_SECRET_LENGTH} characters in ${tooShort.map((env) => env.file).join(", ")}` : "",
      ].filter(Boolean).join("; ")}`,
      detail: ["the api sends it to the web app's revalidate hook; without it the 2 admin e2e tests fail"],
      fix: [
        ...tooShort.map((env) => `delete the ${SECRET}=... line in ${env.file}`),
        `${tooShort.length > 0 ? "then run" : "run"} (one new secret, written into each file; the api and the web app must share it):`,
        "  SECRET=$(openssl rand -hex 32)",
        ...[...missing, ...tooShort].map((env) => `  printf '\\n${SECRET}=%s\\n' "$SECRET" >> ${env.file}`),
      ],
    };
  }

  // 3b. Both set and long enough: are they the SAME? (Compared, never printed.)
  const api = envs.api.values?.[SECRET];
  const web = envs.web.values?.[SECRET];
  if (api !== undefined && web !== undefined && api !== web) {
    return {
      status: "fail",
      title: `${SECRET} differs between ${envs.api.file} and ${envs.web.file} (values not shown)`,
      detail: ["the web app would answer the api's revalidate call with 401"],
      fix: [`copy the ${SECRET} line from ${envs.api.file} into ${envs.web.file} (replace the old one)`],
    };
  }
  return { status: "ok", title: `${SECRET}: set, ${MIN_SECRET_LENGTH}+ characters, the same in the api and the web app` };
}

// 4. The port in a URL, with the protocol's default when none is written.
function portOf(url: URL): string {
  return url.port || (url.protocol === "https:" ? "443" : url.protocol === "redis:" ? "6379" : "80");
}

function parseUrl(value: string | undefined): URL | undefined {
  if (!value) return undefined;
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

// 5. Settings that live in TWO files and must agree. Each mismatch says which file to change.
//    Only checked when both sides are there (a missing line is reported by checkEnvFile already).
export function checkAgreement(envs: EnvFiles): CheckResult[] {
  if (Object.values(envs).some((env) => env.values === undefined)) {
    return [{ status: "warn", title: "agreement between the files: skipped until all 4 exist" }];
  }
  const root: EnvValues = envs.root.values ?? {};
  const api: EnvValues = envs.api.values ?? {};
  const web: EnvValues = envs.web.values ?? {};
  const worker: EnvValues = envs.worker.values ?? {};
  const problems: CheckResult[] = [];

  // 5a. The api logs in to Postgres with DATABASE_URL; the container was created with the root
  //     .env's POSTGRES_*. Name the parts that differ, never their values.
  const db = parseUrl(api.DATABASE_URL);
  if (db && root.POSTGRES_USER !== undefined) {
    const differs = [
      decodeURIComponent(db.username) !== root.POSTGRES_USER ? "user" : "",
      decodeURIComponent(db.password) !== root.POSTGRES_PASSWORD ? "password" : "",
      db.pathname.slice(1) !== root.POSTGRES_DB ? "database name" : "",
    ].filter(Boolean);
    if (differs.length > 0) {
      problems.push({
        status: "fail",
        title: `DATABASE_URL in ${envs.api.file} does not match POSTGRES_* in .env (${differs.join(", ")})`,
        fix: ["make DATABASE_URL postgres://<POSTGRES_USER>:<POSTGRES_PASSWORD>@localhost:5432/<POSTGRES_DB>"],
      });
    }
  }

  // 5b. Compose publishes Redis on REDIS_PORT (default 6379); the api must connect to that port.
  const redis = parseUrl(api.REDIS_URL);
  const redisPort = root.REDIS_PORT ?? "6379";
  if (redis && envs.root.values && portOf(redis) !== redisPort) {
    problems.push({
      status: "fail",
      title: `REDIS_URL in ${envs.api.file} uses port ${portOf(redis)}, but .env publishes Redis on ${redisPort}`,
      fix: [`use the same port in both: REDIS_PORT=${redisPort} in .env and redis://localhost:${redisPort} in ${envs.api.file}`],
    });
  }

  // 5c. The relay and local setup must agree on the topic and Moto endpoint.
  for (const key of ["BOOKING_EVENTS_TOPIC_ARN", "SNS_ENDPOINT"]) {
    if (api[key] && worker[key] && api[key] !== worker[key]) {
      problems.push({ status: "fail", title: `${key} differs between api and worker`,
        fix: [`use the same ${key} in apps/api/.env and apps/worker/.env`] });
    }
  }

  // 5d. The web app (browser and server) calls the api on the api's PORT.
  if (api.PORT) {
    for (const key of ["NEXT_PUBLIC_API_URL", "API_INTERNAL_URL"]) {
      const url = parseUrl(web[key]);
      if (url && portOf(url) !== api.PORT) {
        problems.push({
          status: "fail",
          title: `${key} in ${envs.web.file} uses port ${portOf(url)}, but the api listens on PORT=${api.PORT}`,
          fix: [`make them the same port (default 4000)`],
        });
      }
    }
  }

  // 5e. The api reaches the web server (WEB_INTERNAL_URL) where browsers do (WEB_ORIGIN).
  const origin = parseUrl(api.WEB_ORIGIN);
  const internal = parseUrl(api.WEB_INTERNAL_URL);
  if (origin && internal && portOf(origin) !== portOf(internal)) {
    problems.push({
      status: "fail",
      title: `WEB_INTERNAL_URL (port ${portOf(internal)}) and WEB_ORIGIN (port ${portOf(origin)}) in ${envs.api.file} point at different ports`,
      fix: ["both are the web app's address locally (default http://localhost:3000)"],
    });
  }

  if (problems.length === 0) {
    problems.push({ status: "ok", title: "the files agree with each other (database login, Redis port, api port, web port, SNS topic)" });
  }
  return problems;
}

// 6. A variable set in your SHELL wins over the env file: `node --env-file` (how the apps start)
//    never overwrites a variable that is already set. Easy to forget after an `export`.
export function checkShellOverrides(envs: EnvFiles, processEnv: NodeJS.ProcessEnv): CheckResult {
  const keys = new Set(Object.values(envs).flatMap((env) => [...env.exampleLines.keys()]));
  const overridden = [...keys].filter((key) => processEnv[key] !== undefined).sort();
  if (overridden.length === 0) return { status: "ok", title: "no setting is overridden by your shell" };
  return {
    status: "warn",
    title: `set in your shell, so these win over the env files: ${overridden.join(", ")}`,
    fix: [`unset ${overridden.join(" ")}   (unless you meant it)`],
  };
}

// 7. All env checks, in the order they are printed.
export function envChecks(envs: EnvFiles, processEnv: NodeJS.ProcessEnv): CheckResult[] {
  return [
    ...Object.values(envs).map(checkEnvFile),
    checkRevalidateSecret(envs),
    ...checkAgreement(envs),
    checkShellOverrides(envs, processEnv),
  ];
}

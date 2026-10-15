import { describe, expect, it } from "vitest";
import { checkAgreement, checkEnvFile, checkRevalidateSecret, checkShellOverrides } from "./env-checks.ts";
import { exampleLines, type EnvFile, type EnvFileKey, type EnvValues } from "./env-files.ts";

// Small stand-ins for the four env files and their examples (not the real files, so the tests
// don't change when an example gains a line).
const EXAMPLES: Record<EnvFileKey, string> = {
  root: "# comment\nPOSTGRES_USER=minitickets\nPOSTGRES_PASSWORD=minitickets\nPOSTGRES_DB=minitickets\nREDIS_PORT=6379\nREVALIDATE_SECRET=CHANGE-ME\n",
  api: "PORT=4000\nWEB_ORIGIN=http://localhost:3000\nDATABASE_URL=postgres://minitickets:minitickets@localhost:5432/minitickets\nREDIS_URL=redis://localhost:6379\nWEB_INTERNAL_URL=http://localhost:3000\nREVALIDATE_SECRET=CHANGE-ME\n# LOG_LEVEL=info\nJOBS_QUEUE_URL=http://localhost:9324/000000000000/minitickets-jobs\n",
  web: "NEXT_PUBLIC_API_URL=http://localhost:4000\nAPI_INTERNAL_URL=http://localhost:4000\nREVALIDATE_SECRET=CHANGE-ME\n",
  worker: "JOBS_QUEUE_URL=http://localhost:9324/000000000000/minitickets-jobs\n",
};
const SECRET_A = "a".repeat(64);
const SECRET_B = "b".repeat(64);

// A healthy set: every file has every example setting, with a real shared secret.
function healthyValues(): Record<EnvFileKey, EnvValues> {
  const values = {} as Record<EnvFileKey, EnvValues>;
  for (const key of Object.keys(EXAMPLES) as EnvFileKey[]) {
    values[key] = Object.fromEntries([...exampleLines(EXAMPLES[key])].map(([name, line]) => [name, line.split("=").slice(1).join("=")]));
  }
  values.root.REVALIDATE_SECRET = SECRET_A;
  values.api.REVALIDATE_SECRET = SECRET_A;
  values.web.REVALIDATE_SECRET = SECRET_A;
  return values;
}

function envs(values: Record<EnvFileKey, EnvValues | undefined>): Record<EnvFileKey, EnvFile> {
  const files = { root: ".env", api: "apps/api/.env", web: "apps/web/.env.local", worker: "apps/worker/.env" };
  const result = {} as Record<EnvFileKey, EnvFile>;
  for (const key of Object.keys(files) as EnvFileKey[]) {
    result[key] = {
      key,
      file: files[key],
      example: `${files[key]}.example`,
      readBy: key,
      values: values[key],
      exampleLines: exampleLines(EXAMPLES[key]),
    };
  }
  return result;
}

describe("exampleLines", () => {
  it("keeps KEY=value lines in order and skips comments", () => {
    expect([...exampleLines(EXAMPLES.api).keys()]).toEqual([
      "PORT", "WEB_ORIGIN", "DATABASE_URL", "REDIS_URL", "WEB_INTERNAL_URL", "REVALIDATE_SECRET", "JOBS_QUEUE_URL",
    ]);
  });
});

describe("checkEnvFile", () => {
  it("a missing file: fail, with the cp command", () => {
    const result = checkEnvFile(envs({ ...healthyValues(), api: undefined }).api);
    expect(result.status).toBe("fail");
    expect(result.fix).toEqual(["cp apps/api/.env.example apps/api/.env"]);
  });

  it("missing settings: fail, with the exact lines from the example (the secret is left to its own check)", () => {
    const values = healthyValues();
    delete values.api.WEB_INTERNAL_URL;
    delete values.api.JOBS_QUEUE_URL;
    delete values.api.REVALIDATE_SECRET;
    const result = checkEnvFile(envs(values).api);
    expect(result.status).toBe("fail");
    expect(result.title).toContain("2 settings missing: WEB_INTERNAL_URL, JOBS_QUEUE_URL");
    expect(result.fix).toEqual([
      "add these lines to apps/api/.env (from apps/api/.env.example):",
      "  WEB_INTERNAL_URL=http://localhost:3000",
      "  JOBS_QUEUE_URL=http://localhost:9324/000000000000/minitickets-jobs",
    ]);
  });

  it("an optional (commented) setting is not required", () => {
    expect(checkEnvFile(envs(healthyValues()).api).status).toBe("ok");
  });
});

describe("checkRevalidateSecret", () => {
  it("missing in some files: fail, one openssl secret appended to exactly those files", () => {
    const values = healthyValues();
    delete values.api.REVALIDATE_SECRET;
    delete values.web.REVALIDATE_SECRET;
    const result = checkRevalidateSecret(envs(values));
    expect(result.status).toBe("fail");
    expect(result.fix).toEqual([
      "run (one new secret, written into each file; the api and the web app must share it):",
      "  SECRET=$(openssl rand -hex 32)",
      "  printf '\\nREVALIDATE_SECRET=%s\\n' \"$SECRET\" >> apps/api/.env",
      "  printf '\\nREVALIDATE_SECRET=%s\\n' \"$SECRET\" >> apps/web/.env.local",
    ]);
  });

  it("the CHANGE-ME placeholder is too short: fail, delete the old line first", () => {
    const values = healthyValues();
    values.web.REVALIDATE_SECRET = "CHANGE-ME";
    const result = checkRevalidateSecret(envs(values));
    expect(result.status).toBe("fail");
    expect(result.fix?.[0]).toBe("delete the REVALIDATE_SECRET=... line in apps/web/.env.local");
  });

  it("different values in the api and the web app: fail, and neither value is printed", () => {
    const values = healthyValues();
    values.web.REVALIDATE_SECRET = SECRET_B;
    const result = checkRevalidateSecret(envs(values));
    expect(result.status).toBe("fail");
    expect(JSON.stringify(result)).not.toContain(SECRET_A);
    expect(JSON.stringify(result)).not.toContain(SECRET_B);
  });

  it("an env file that needs it is missing: skipped (a warning), never a false ok", () => {
    const result = checkRevalidateSecret(envs({ ...healthyValues(), web: undefined }));
    expect(result.status).toBe("warn");
  });

  it("the same long secret in both: ok (the root copy may differ: only app:up uses it)", () => {
    const values = healthyValues();
    values.root.REVALIDATE_SECRET = SECRET_B;
    expect(checkRevalidateSecret(envs(values)).status).toBe("ok");
  });
});

describe("checkAgreement", () => {
  it("everything agrees: one ok line", () => {
    const results = checkAgreement(envs(healthyValues()));
    expect(results.map((r) => r.status)).toEqual(["ok"]);
  });

  it("a missing file: skipped (a warning), never a false ok", () => {
    expect(checkAgreement(envs({ ...healthyValues(), worker: undefined })).map((r) => r.status)).toEqual(["warn"]);
  });

  it("a different database password: fail, names the part, never the passwords", () => {
    const values = healthyValues();
    values.root.POSTGRES_PASSWORD = "root-pw-123";
    values.api.DATABASE_URL = "postgres://minitickets:api-pw-456@localhost:5432/minitickets";
    const [result] = checkAgreement(envs(values));
    expect(result.status).toBe("fail");
    expect(result.title).toContain("(password)");
    expect(JSON.stringify(result)).not.toContain("root-pw-123");
    expect(JSON.stringify(result)).not.toContain("api-pw-456");
  });

  it("Redis on another host port than REDIS_URL: fail (REDIS_PORT defaults to 6379)", () => {
    const values = healthyValues();
    values.root.REDIS_PORT = "6380";
    expect(checkAgreement(envs(values))[0].title).toContain("uses port 6379, but .env publishes Redis on 6380");
    delete values.root.REDIS_PORT;
    values.api.REDIS_URL = "redis://localhost:6380";
    expect(checkAgreement(envs(values))[0].title).toContain("uses port 6380, but .env publishes Redis on 6379");
  });

  it("the api publishes to another queue than the worker reads: fail", () => {
    const values = healthyValues();
    values.worker.JOBS_QUEUE_URL = "http://localhost:9324/000000000000/other";
    expect(checkAgreement(envs(values))[0].title).toContain("JOBS_QUEUE_URL differs");
  });

  it("the web app calls the api on another port: fail", () => {
    const values = healthyValues();
    values.api.PORT = "4101";
    const titles = checkAgreement(envs(values)).map((r) => r.title);
    expect(titles).toHaveLength(2);
    expect(titles[0]).toContain("NEXT_PUBLIC_API_URL in apps/web/.env.local uses port 4000, but the api listens on PORT=4101");
  });
});

describe("checkShellOverrides", () => {
  it("warns about settings exported in the shell (they win over the files)", () => {
    const result = checkShellOverrides(envs(healthyValues()), { DATABASE_URL: "x", HOME: "/home/me" });
    expect(result.status).toBe("warn");
    expect(result.title).toContain("DATABASE_URL");
    expect(result.title).not.toContain("HOME");
  });
});

import { describe, expect, it } from "vitest";
import { DatabaseEnvSchema } from "./database";

// 1. The five AWS pieces, all present. Values are made up.
const awsVars = {
  DB_HOST: "minitickets-dev-db.abc123.us-east-1.rds.amazonaws.com",
  DB_PORT: "5432",
  DB_NAME: "minitickets",
  DB_USER: "minitickets",
  DB_PASSWORD: "not-a-real-password",
};

describe("DatabaseEnvSchema", () => {
  it("local: DATABASE_URL becomes a connection string without SSL", () => {
    const config = DatabaseEnvSchema.parse({ DATABASE_URL: "postgres://u:p@localhost:5432/db" });
    expect(config).toEqual({ connectionString: "postgres://u:p@localhost:5432/db" });
  });

  it("AWS: the DB_* pieces become host settings with VERIFIED SSL", () => {
    const config = DatabaseEnvSchema.parse(awsVars);
    expect(config).toMatchObject({ host: awsVars.DB_HOST, port: 5432, database: "minitickets", user: "minitickets" });
    // 2. The important part: SSL is on and the certificate is checked.
    expect(config.ssl).toEqual({ rejectUnauthorized: true });
  });

  it("rejects when neither way is given", () => {
    expect(DatabaseEnvSchema.safeParse({}).success).toBe(false);
  });

  it("names the missing pieces when DB_* is incomplete", () => {
    const result = DatabaseEnvSchema.safeParse({ DB_HOST: awsVars.DB_HOST });
    expect(result.error?.issues[0]?.message).toContain("DB_PORT, DB_NAME, DB_USER, DB_PASSWORD");
  });

  it("rejects both ways at once", () => {
    const result = DatabaseEnvSchema.safeParse({ ...awsVars, DATABASE_URL: "postgres://u:p@localhost:5432/db" });
    expect(result.success).toBe(false);
  });
});

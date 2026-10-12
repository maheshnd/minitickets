import type { PoolConfig } from "pg";
import { z } from "zod";

// The database settings, shared by the API (config/env.ts) and the migration runner (db/migrate.ts).
// There are two ways to give them:
//   Local, Docker Compose, CI:  DATABASE_URL=postgres://user:password@host:5432/name
//   AWS (ECS):                  DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD
// WHY two ways: on AWS, the user name and password come from the RDS secret as two separate
// values, and ECS can only put a secret value into its own env var. It cannot glue pieces into
// a URL. See docs/17-infra-ecs-api.md.

const PARTS = ["DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_PASSWORD"] as const;

// @concept: config-validation
export const DatabaseEnvSchema = z
  // 1. Every variable is optional on its own. Step 2 checks that exactly one full set is there.
  .object({
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }).optional(),
    DB_HOST: z.string().min(1).optional(),
    // process.env values are always strings; z.coerce turns "5432" into the number 5432.
    DB_PORT: z.coerce.number().int().positive().optional(),
    DB_NAME: z.string().min(1).optional(),
    DB_USER: z.string().min(1).optional(),
    DB_PASSWORD: z.string().min(1).optional(),
  })
  // 2. Turn whichever set is present into the settings pg's Pool expects.
  .transform((vars, ctx): PoolConfig => {
    const missingParts = PARTS.filter((name) => vars[name] === undefined);
    const hasAnyPart = missingParts.length < PARTS.length;

    // 2a. Both ways at once is a mistake: we would have to guess which one is meant.
    if (vars.DATABASE_URL && hasAnyPart) {
      ctx.addIssue({ code: "custom", message: "Set DATABASE_URL OR the DB_* variables, not both" });
      return z.NEVER;
    }

    // 2b. Local: one URL. No SSL, because the local Docker Postgres does not offer it.
    if (vars.DATABASE_URL) {
      return { connectionString: vars.DATABASE_URL };
    }

    // 2c. Neither way is complete: name exactly what is missing.
    if (!vars.DB_HOST || !vars.DB_PORT || !vars.DB_NAME || !vars.DB_USER || !vars.DB_PASSWORD) {
      const message = hasAnyPart
        ? `Missing ${missingParts.join(", ")} (needed when DB_* is used)`
        : "Set DATABASE_URL (local) or DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD (AWS)";
      ctx.addIssue({ code: "custom", message });
      return z.NEVER;
    }

    // @concept: tls-in-transit
    // 2d. AWS: the pieces, with SSL turned ON.
    //     WHY SSL: RDS refuses connections without it (rds.force_ssl = 1), and the password and
    //     all data would otherwise cross the network as plain text.
    //     WHY rejectUnauthorized: true: the API checks that the server's certificate is signed by
    //     a trusted authority AND is made out to DB_HOST. Without that check, anyone who can sit
    //     between us and the database could pretend to be it and read our password. NEVER set it
    //     to false. The RDS certificate authority is not one Node trusts by default; the API
    //     Dockerfile adds it (NODE_EXTRA_CA_CERTS).
    return {
      host: vars.DB_HOST,
      port: vars.DB_PORT,
      database: vars.DB_NAME,
      user: vars.DB_USER,
      password: vars.DB_PASSWORD,
      ssl: { rejectUnauthorized: true },
    };
  });

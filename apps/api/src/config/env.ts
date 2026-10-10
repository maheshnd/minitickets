import { z } from "zod";

// 1. Describe every environment variable the API needs.
const EnvSchema = z.object({
  // process.env values are always strings; z.coerce turns "4000" into the number 4000.
  PORT: z.coerce.number().int().positive(),
  // The web app's URL. CORS allows browser requests only from this origin.
  WEB_ORIGIN: z.url(),
  // Postgres connection string. Must be a postgres:// (or postgresql://) URL.
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
});

// 2. Check process.env against the schema once, when the API starts.
const result = EnvSchema.safeParse(process.env);

// 3. Fail fast: if anything is missing or invalid, say what and stop right away.
//    A crash at startup is much easier to fix than a strange bug later.
if (!result.success) {
  console.error("Invalid environment variables:", z.flattenError(result.error).fieldErrors);
  console.error("Hint: copy apps/api/.env.example to apps/api/.env");
  process.exit(1);
}

// 4. Export the validated, typed values. Other files use `env`, never process.env.
export const env = result.data;

import { z } from "zod";
import { DatabaseEnvSchema } from "./database";

// @concept: config-validation
// @concept: twelve-factor-config
// 1. Describe every environment variable the API needs (the database ones live in ./database.ts).
const EnvSchema = z.object({
  // process.env values are always strings; z.coerce turns "4000" into the number 4000.
  PORT: z.coerce.number().int().positive(),
  // Which network address to listen on. 127.0.0.1 = only this machine (safe for local dev).
  // Inside a Docker container this must be 0.0.0.0, or the published port cannot reach the API.
  HOST: z.string().default("127.0.0.1"),
  // The web app's URL. CORS allows browser requests only from this origin.
  WEB_ORIGIN: z.url(),
  // Redis connection string (sessions live here). Must be a redis:// (or rediss://) URL.
  // rediss:// (AWS Valkey) makes ioredis use TLS and check the server's certificate by itself.
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
  // Only "production" changes behavior: it turns on the Secure flag of the session cookie.
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  // How many proxies stand in front of the API (see ./trust-proxy.ts). 0 = none (local dev,
  // Docker, CI). On AWS it is 2: CloudFront, then the load balancer (set in the task definition).
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
});

// 2. Check process.env once, when the API starts: the app settings and the database settings.
const app = EnvSchema.safeParse(process.env);
const database = DatabaseEnvSchema.safeParse(process.env);

// 3. Fail fast: if anything is missing or invalid, say what and stop right away.
//    A crash at startup is much easier to fix than a strange bug later.
if (!app.success || !database.success) {
  if (!app.success) console.error("Invalid environment variables:", z.flattenError(app.error).fieldErrors);
  if (!database.success) console.error("Invalid database settings:", z.flattenError(database.error).formErrors);
  console.error("Hint: copy apps/api/.env.example to apps/api/.env");
  process.exit(1);
}

// 4. Export the validated, typed values. Other files use `env`, never process.env.
//    env.database is ready to pass to pg's Pool (a URL locally, host + user + SSL on AWS).
export const env = { ...app.data, database: database.data };

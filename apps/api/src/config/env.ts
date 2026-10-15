import { RevalidateSecretSchema } from "@minitickets/shared";
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
  // The lowest log level that is printed. "info" hides debug lines (like "db query: …"); start
  // the API with LOG_LEVEL=debug to see them, e.g. when counting database queries.
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  // The events list cache's two TTLs, in milliseconds (see services/events.ts, step 1).
  // SOFT: how long a cached list counts as fresh. HARD: when Redis deletes it (the oldest it may
  // ever be served). Shorten both for a demo, e.g. 3000 and 60000.
  EVENTS_CACHE_SOFT_TTL_MS: z.coerce.number().int().positive().default(30_000),
  EVENTS_CACHE_HARD_TTL_MS: z.coerce.number().int().positive().default(300_000),
  // The web app's revalidate hook (queries/web-cache.ts): after an event is created, the API tells
  // the web server to drop its cached events list. API -> web, server to server, so this is the
  // web server's INTERNAL address (http://localhost:3000 locally, http://web:3000 in compose),
  // not the browser's WEB_ORIGIN. The secret proves to the web app that the call is from us.
  // OPTIONAL, but only as a PAIR: without them the hook is off (a warning at startup) and the web
  // cache's own 30 s lifetime bounds the staleness. WHY not required: on AWS with only the compute
  // switch on there IS no web app (it comes with the entry switch, which also adds the Service
  // Connect route to it, infra/src/compute/service-connect.ts); a required value would stop the
  // whole API from starting there, for a feature that only makes lists fresher.
  WEB_INTERNAL_URL: z.url({ protocol: /^https?$/ }).optional(),
  REVALIDATE_SECRET: RevalidateSecretSchema.optional(),
  // The jobs queue (queues/jobs.ts). OPTIONAL: without JOBS_QUEUE_URL the outbox relay is paused;
  // confirmations are still saved with bookings and delivered when the queue is configured.
  // JOBS_QUEUE_URL: the queue's URL (local: the ElasticMQ container, on AWS: the SQS queue's URL).
  JOBS_QUEUE_URL: z.url({ protocol: /^https?$/ }).optional(),
  // SQS_ENDPOINT: LOCAL ONLY. Points the AWS SDK at the ElasticMQ container instead of real SQS.
  // Leave it unset on AWS: the SDK then finds SQS by itself.
  SQS_ENDPOINT: z.url({ protocol: /^https?$/ }).optional(),
  // The AWS region the SDK signs requests for (any value works for ElasticMQ). us-east-1 is the
  // region of our AWS setup (infra/Pulumi.dev.yaml).
  AWS_REGION: z.string().min(1).default("us-east-1"),
})
  // A soft TTL at or above the hard TTL would mean "never stale": Redis would delete the list
  // while it still counts as fresh. Almost surely a typo, so we stop at startup.
  .refine((e) => e.EVENTS_CACHE_SOFT_TTL_MS < e.EVENTS_CACHE_HARD_TTL_MS, {
    message: "must be greater than EVENTS_CACHE_SOFT_TTL_MS",
    path: ["EVENTS_CACHE_HARD_TTL_MS"],
  })
  // Only one of the pair set is half a configuration (a URL with no secret would always get 401):
  // almost surely a forgotten line, so we stop at startup instead of silently turning the hook off.
  .refine((e) => (e.WEB_INTERNAL_URL === undefined) === (e.REVALIDATE_SECRET === undefined), {
    message: "set both WEB_INTERNAL_URL and REVALIDATE_SECRET, or neither",
    path: ["REVALIDATE_SECRET"],
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

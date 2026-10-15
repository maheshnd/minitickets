import { z } from "zod";

// The worker's settings, validated once at startup (same idea as apps/api/src/config/env.ts).
const EnvSchema = z.object({
  // 1. The queues. Optional HERE because on AWS, Lambda reads the queue for us and never needs its
  //    URL. The local runner (local.ts) and the scripts check that the one they need is set.
  JOBS_QUEUE_URL: z.url({ protocol: /^https?$/ }).optional(),
  // The dead-letter queue (docker/elasticmq.conf). Only the jobs:dlq / jobs:redrive scripts use it.
  JOBS_DLQ_URL: z.url({ protocol: /^https?$/ }).optional(),
  // Local only: points the AWS SDK at the ElasticMQ container. Unset on AWS.
  SQS_ENDPOINT: z.url({ protocol: /^https?$/ }).optional(),
  AWS_REGION: z.string().min(1).default("us-east-1"),

  // 2. The DynamoDB table that remembers which jobs are done (the idempotent consumer,
  //    src/processed-jobs.ts). Locally DYNAMODB_ENDPOINT points at the DynamoDB Local container;
  //    on AWS it is unset and the SDK finds the real service by itself.
  PROCESSED_JOBS_TABLE: z.string().min(1).default("minitickets-processed-jobs"),
  DYNAMODB_ENDPOINT: z.url({ protocol: /^https?$/ }).optional(),

  // 3. FAULT INJECTION, for demos only (src/faulty-mailer.ts): make the mailer fail on purpose.
  //    "off" (default) | "always" | "first-n:<n>" (the first n emails fail, then all succeed).
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  MAILER_FAIL_MODE: z
    .string()
    .regex(/^(off|always|first-n:[1-9][0-9]*)$/, 'use "off", "always" or "first-n:<n>"')
    .default("off"),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment variables:", z.flattenError(parsed.error).fieldErrors);
  console.error("Hint: copy apps/worker/.env.example to apps/worker/.env");
  process.exit(1);
}

// 4. A mailer that fails on purpose has no business in production: refuse to start. This check
//    is the reason the switch is safe to have in the code at all.
if (parsed.data.NODE_ENV === "production" && parsed.data.MAILER_FAIL_MODE !== "off") {
  console.error(`MAILER_FAIL_MODE=${parsed.data.MAILER_FAIL_MODE} is for local demos only; refusing to start with NODE_ENV=production.`);
  process.exit(1);
}

export const env = parsed.data;

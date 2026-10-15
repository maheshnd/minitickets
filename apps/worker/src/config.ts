import { z } from "zod";

// The worker's settings, validated once at startup (same idea as apps/api/src/config/env.ts).
const EnvSchema = z.object({
  // 1. The queues. Lambda READS the queue for us, but the handler still needs its URL to delay a
  //    failed message's retry (backoff, src/retry-later.ts), so the Lambda gets it too
  //    (infra/src/jobs/worker-lambda.ts). Optional HERE so the scripts that only need the DLQ still
  //    start; the local runner (local.ts) and the scripts check that the one they need is set.
  JOBS_QUEUE_URL: z.url({ protocol: /^https?$/ }).optional(),
  // The dead-letter queue (docker/elasticmq.conf). Only the jobs:dlq / jobs:redrive scripts use it.
  JOBS_DLQ_URL: z.url({ protocol: /^https?$/ }).optional(),
  // Local only: points the AWS SDK at the ElasticMQ container. Unset on AWS.
  SQS_ENDPOINT: z.url({ protocol: /^https?$/ }).optional(),
  AWS_REGION: z.string().min(1).default("us-east-1"),
  // P4: optional for email-only scripts. ticket-lambda.ts requires the three resource names.
  TICKETS_QUEUE_URL: z.url({ protocol: /^https?$/ }).optional(),
  TICKETS_DLQ_URL: z.url({ protocol: /^https?$/ }).optional(),
  TICKETS_TABLE: z.string().min(1).optional(),
  TICKETS_BUCKET: z.string().min(1).optional(),
  TICKET_SIGNING_SECRET_ID: z.string().min(1).optional(),
  S3_ENDPOINT: z.url({ protocol: /^https?$/ }).optional(),
  SECRETS_MANAGER_ENDPOINT: z.url({ protocol: /^https?$/ }).optional(),
  SNS_ENDPOINT: z.url({ protocol: /^https?$/ }).optional(),
  BOOKING_EVENTS_TOPIC_ARN: z.string().optional(),

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

  // 4. Which mailer sends the emails (src/lambda.ts picks it):
  //    "log" (default, local): writes a log line instead of sending (src/mailer.ts).
  //    "ses" (AWS):            really sends, through Amazon SES (src/ses-mailer.ts). Set by
  //                            infra/src/jobs/worker-lambda.ts, together with MAIL_FROM.
  MAILER: z.enum(["log", "ses"]).default("log"),
  // The sender address. SES only sends FROM an address of a VERIFIED identity (our domain,
  // infra/src/jobs/email.ts), so it must be an address at that domain. Needed only for "ses".
  MAIL_FROM: z.email().optional(),
})
  // 5. "ses" without a sender is half a configuration: stop at startup, not at the first email.
  .refine((e) => e.MAILER !== "ses" || e.MAIL_FROM !== undefined, {
    message: "MAILER=ses needs MAIL_FROM (an address at the verified SES domain)",
    path: ["MAIL_FROM"],
  });

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment variables:", z.flattenError(parsed.error).fieldErrors);
  console.error("Hint: copy apps/worker/.env.example to apps/worker/.env");
  process.exit(1);
}

// 6. A mailer that fails on purpose has no business in production: refuse to start. This check
//    is the reason the switch is safe to have in the code at all.
if (parsed.data.NODE_ENV === "production" && parsed.data.MAILER_FAIL_MODE !== "off") {
  console.error(`MAILER_FAIL_MODE=${parsed.data.MAILER_FAIL_MODE} is for local demos only; refusing to start with NODE_ENV=production.`);
  process.exit(1);
}

export const env = parsed.data;

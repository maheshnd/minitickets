import { z } from "zod";

// The worker's settings, validated once at startup (same idea as apps/api/src/config/env.ts).
// JOBS_QUEUE_URL is required here: a worker with no queue has nothing to do.
const EnvSchema = z.object({
  JOBS_QUEUE_URL: z.url({ protocol: /^https?$/ }),
  // Local only: points the AWS SDK at the ElasticMQ container. Unset on AWS.
  SQS_ENDPOINT: z.url({ protocol: /^https?$/ }).optional(),
  AWS_REGION: z.string().min(1).default("us-east-1"),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment variables:", z.flattenError(parsed.error).fieldErrors);
  console.error("Hint: copy apps/worker/.env.example to apps/worker/.env");
  process.exit(1);
}
export const env = parsed.data;

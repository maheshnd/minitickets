import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import type { SQSBatchResponse, SQSEvent } from "aws-lambda";
import { handleBatch } from "./batch";
import { env } from "./config";
import { FaultyMailer } from "./faulty-mailer";
import { LogMailer } from "./mailer";
import { DynamoProcessedJobs } from "./processed-jobs";

// The Lambda-shaped entry point: a function that receives an SQSEvent (a batch of queue messages)
// and answers which of them failed. This is the function AWS Lambda will call when the worker is
// deployed (step S1c). Locally, local.ts calls it too: ONE code path in both places.
// The real dependencies are built here, once per process, and nowhere else.

// 1. The DynamoDB client. DYNAMODB_ENDPOINT is set locally (DynamoDB Local) and unset on AWS.
//    Short timeouts keep a handler's run time well under the queue's visibility timeout (30 s,
//    docker/elasticmq.conf): a stuck call fails fast, and the message is retried, instead of the
//    message reappearing while we are still busy with it.
const dynamo = new DynamoDBClient({
  region: env.AWS_REGION,
  endpoint: env.DYNAMODB_ENDPOINT,
  requestHandler: { connectionTimeout: 1000, requestTimeout: 3000 },
});

// 2. The mailer. S1c swaps LogMailer for the SES mailer here, in one line. MAILER_FAIL_MODE wraps
//    it in the demo-only FaultyMailer (config.ts refuses that in production).
const mailer = env.MAILER_FAIL_MODE === "off" ? new LogMailer() : new FaultyMailer(new LogMailer(), env.MAILER_FAIL_MODE);
if (env.MAILER_FAIL_MODE !== "off") {
  console.warn(`[worker] MAILER_FAIL_MODE=${env.MAILER_FAIL_MODE}: the mailer fails ON PURPOSE (demo only)`);
}

const deps = { mailer, processedJobs: new DynamoProcessedJobs(dynamo, env.PROCESSED_JOBS_TABLE) };

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  // 3. Returns { batchItemFailures } listing ONLY the failed messages (see batch.ts).
  return handleBatch(event, deps);
}

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { SESv2Client } from "@aws-sdk/client-sesv2";
import { SQSClient } from "@aws-sdk/client-sqs";
import type { SQSBatchResponse, SQSEvent } from "aws-lambda";
import { handleBatch } from "./batch";
import { env } from "./config";
import { FaultyMailer } from "./faulty-mailer";
import { LogMailer, type Mailer } from "./mailer";
import { DynamoProcessedJobs } from "./processed-jobs";
import { delayFailedMessages } from "./retry-later";
import { SesMailer } from "./ses-mailer";

// @concept: aws-lambda
// The Lambda-shaped entry point: a function that receives an SQSEvent (a batch of queue messages)
// and answers which of them failed. On AWS, Lambda calls it (the image's CMD is "lambda.handler",
// apps/worker/Dockerfile). Locally, local.ts calls it too: ONE code path in both places.
// The real dependencies are built here, once per process, and nowhere else.
//
// "Once per process" matters on Lambda: this file's top level runs once per COLD START (a new
// Lambda instance), then the same instance handles many batches. So the clients below (and their
// open connections) are reused, instead of being built again for every batch.

// 1. Short timeouts for every AWS call. The Lambda may run 10 s at most (its timeout,
//    infra/src/jobs/worker-lambda.ts) and the queue hides a message for 60 s (6 x that). A stuck
//    call should fail fast, so the message is reported as failed and retried with backoff, instead
//    of the whole batch running into the Lambda timeout.
const requestHandler = { connectionTimeout: 1000, requestTimeout: 3000 };

// 2. The DynamoDB client. DYNAMODB_ENDPOINT is set locally (DynamoDB Local) and unset on AWS.
const dynamo = new DynamoDBClient({ region: env.AWS_REGION, endpoint: env.DYNAMODB_ENDPOINT, requestHandler });

// 3. The SQS client, for the backoff only (src/retry-later.ts): Lambda itself reads and deletes.
//    SQS_ENDPOINT is set locally (ElasticMQ) and unset on AWS.
const sqs = new SQSClient({ region: env.AWS_REGION, endpoint: env.SQS_ENDPOINT, requestHandler });

// 4. The mailer: SES on AWS (MAILER=ses + MAIL_FROM, set by infra), LogMailer locally.
//    MAILER_FAIL_MODE wraps it in the demo-only FaultyMailer (config.ts refuses that in production).
function chooseMailer(): Mailer {
  const real = env.MAILER === "ses" && env.MAIL_FROM
    ? new SesMailer(new SESv2Client({ region: env.AWS_REGION, requestHandler }), env.MAIL_FROM)
    : new LogMailer();
  if (env.MAILER_FAIL_MODE === "off") return real;
  console.warn(`[worker] MAILER_FAIL_MODE=${env.MAILER_FAIL_MODE}: the mailer fails ON PURPOSE (demo only)`);
  return new FaultyMailer(real, env.MAILER_FAIL_MODE);
}

const deps = { mailer: chooseMailer(), processedJobs: new DynamoProcessedJobs(dynamo, env.PROCESSED_JOBS_TABLE) };

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  // 5. Handle the batch: { batchItemFailures } lists ONLY the failed messages (see batch.ts).
  const response = await handleBatch(event, deps);
  // 6. Give each failed message a growing wait before its next try (retry-later.ts), THEN answer.
  //    Lambda (or local.ts) deletes the others and leaves the failed ones in the queue.
  await delayFailedMessages(event, response, sqs, env.JOBS_QUEUE_URL);
  return response;
}

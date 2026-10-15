import { ChangeMessageVisibilityCommand, type SQSClient } from "@aws-sdk/client-sqs";
import type { SQSBatchResponse, SQSEvent } from "aws-lambda";
import { backoffSeconds } from "./backoff";

// @concept: retry-policy
// BACKOFF FOR FAILED MESSAGES, done by the handler itself, so it works the same on AWS and locally.
//
// Why here and not in the runner: on AWS, Lambda's event source mapping reads the queue for us. For
// a message we report as failed it does NOTHING: the message simply reappears when the queue's
// visibility timeout (60 s on AWS) runs out. Lambda has no "wait longer after each failure" setting.
// So, before the handler answers, it sets each failed message's visibility timeout itself
// (ChangeMessageVisibility): 10 s after the 1st failure, 40 s after the 2nd, 120 s after the 3rd
// (src/backoff.ts). Lambda then leaves the message alone, and the queue offers it again after that
// wait. Locally (local.ts) the same handler runs, so the same code applies the same waits.
//
//   message fails ──▶ ChangeMessageVisibility(10 s) ──▶ answer { batchItemFailures: [it] }
//   10 s later the queue offers it again (receive count 2) ... after the 3rd failure, the 4th
//   receive moves it to the dead-letter queue instead (maxReceiveCount 3).
export async function delayFailedMessages(
  event: SQSEvent,
  response: SQSBatchResponse,
  sqs: Pick<SQSClient, "send">,
  queueUrl: string | undefined,
): Promise<void> {
  if (response.batchItemFailures.length === 0) return;

  // 1. Without the queue's URL we cannot call SQS: the failed messages then come back after the
  //    queue's own visibility timeout (no growing wait, but nothing is lost).
  if (!queueUrl) {
    console.warn("[worker] JOBS_QUEUE_URL is not set: failed messages retry after the queue's visibility timeout");
    return;
  }

  const failedIds = new Set(response.batchItemFailures.map((failure) => failure.itemIdentifier));
  for (const record of event.Records.filter((r) => failedIds.has(r.messageId))) {
    // 2. How long to wait depends on how many times the queue delivered it so far.
    const wait = backoffSeconds(Number(record.attributes?.ApproximateReceiveCount ?? "1"));
    try {
      // 3. The receipt handle is THIS delivery's ticket for the message: only the consumer that
      //    received it can change its visibility (or delete it).
      await sqs.send(
        new ChangeMessageVisibilityCommand({ QueueUrl: queueUrl, ReceiptHandle: record.receiptHandle, VisibilityTimeout: wait }),
      );
      console.log(`[worker] message ${record.messageId} stays in the queue, next try in ${wait} s`);
    } catch (err) {
      // 4. Could not set the wait: the message still comes back, just after the queue's default
      //    visibility timeout. Not worth failing anything else for.
      console.error(`[worker] could not delay message ${record.messageId}:`, err instanceof Error ? err.message : err);
    }
  }
}

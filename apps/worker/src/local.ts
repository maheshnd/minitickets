import { DeleteMessageCommand, ReceiveMessageCommand, SQSClient, type Message } from "@aws-sdk/client-sqs";
import type { SQSEvent, SQSRecord } from "aws-lambda";
import { env } from "./config";
import { handler } from "./lambda";

// The LOCAL runner (`pnpm worker:dev`). On AWS, Lambda reads the queue for us and calls
// handler(event). Locally nothing does that, so this file plays Lambda's part: it reads the queue,
// builds the SAME SQSEvent shape, calls the SAME handler, and then does what Lambda does with
// its answer: delete the successes, leave the failures. (The retry backoff for the failures is in
// the handler itself since S1c, src/retry-later.ts, because Lambda has no backoff of its own.)

const queueUrl = env.JOBS_QUEUE_URL;
if (!queueUrl) {
  console.error("JOBS_QUEUE_URL is not set. Hint: copy apps/worker/.env.example to apps/worker/.env");
  process.exit(1);
}

const sqs = new SQSClient({ region: env.AWS_REGION, endpoint: env.SQS_ENDPOINT });
let stopping = false;

// 1. Turn a queue message into the record shape Lambda would give the handler (only the fields we
//    use). ApproximateReceiveCount = how many times the queue has delivered this message so far.
function toRecord(message: Message): SQSRecord {
  return {
    messageId: message.MessageId ?? "",
    receiptHandle: message.ReceiptHandle ?? "",
    body: message.Body ?? "",
    attributes: { ApproximateReceiveCount: message.Attributes?.ApproximateReceiveCount ?? "1" },
  } as SQSRecord;
}

async function poll() {
  console.log(`[worker] listening on ${queueUrl}`);
  while (!stopping) {
    try {
      // 2. LONG POLLING: WaitTimeSeconds 20 makes the request wait up to 20 s for a message and
      //    return the moment there is one. Short polling would ask over and over ("anything
      //    yet?") and burn requests (on AWS, money) while the queue is empty. Up to 10 messages
      //    at once, like a Lambda batch. We also ask for each message's receive count.
      const result = await sqs.send(
        new ReceiveMessageCommand({
          QueueUrl: queueUrl,
          MaxNumberOfMessages: 10,
          WaitTimeSeconds: 20,
          MessageSystemAttributeNames: ["ApproximateReceiveCount"],
        }),
      );
      const messages = result.Messages ?? [];
      if (messages.length === 0) continue;
      console.log(`[worker] received a batch of ${messages.length} message(s)`);

      // 3. The same call Lambda makes. Its answer lists the messages that FAILED. If the handler
      //    itself throws (it should not), treat the whole batch as failed, like Lambda would.
      let failedIds: Set<string>;
      try {
        const response = await handler({ Records: messages.map(toRecord) } as SQSEvent);
        failedIds = new Set(response.batchItemFailures.map((failure) => failure.itemIdentifier));
      } catch (err) {
        console.error("[worker] the handler crashed, the whole batch will be retried:", err instanceof Error ? err.message : err);
        failedIds = new Set(messages.map((message) => message.MessageId ?? ""));
      }

      for (const message of messages) {
        // 4. FAILED: do NOT delete. The handler already set its wait before the next try
        //    (10 s, 40 s, 120 s; src/retry-later.ts). When the wait is over, the queue offers it
        //    again. On the 4th delivery the queue moves it to the dead-letter queue instead
        //    (maxReceiveCount 3, docker/elasticmq.conf). Exactly what Lambda does on AWS.
        if (failedIds.has(message.MessageId ?? "")) continue;

        // 5. DELETE ONLY AFTER SUCCESS (a skipped duplicate is a success too).
        await sqs.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: message.ReceiptHandle }));
        console.log(`[worker] message ${message.MessageId} deleted`);
      }
    } catch (err) {
      // 6. The queue itself is unreachable: say so, wait a little, and try again (do not spin).
      //    Any message not deleted yet simply comes back after its visibility timeout.
      console.error("[worker] cannot read the queue:", err instanceof Error ? err.message : err);
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
}

// 7. Ctrl+C / kill: stop asking for more. A poll in flight may take up to 20 s to end, so exit now
//    unless a message is being handled; the unfinished message simply comes back (nothing is lost).
process.on("SIGINT", () => { stopping = true; process.exit(0); });
process.on("SIGTERM", () => { stopping = true; process.exit(0); });

await poll();

import { DeleteMessageCommand, ReceiveMessageCommand, SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { env } from "../config";

// `pnpm jobs:redrive`: moves every message from the dead-letter queue back to the main queue, so
// the worker tries them again (each starts with a fresh receive count: 3 new tries).
//
// When to use it: only AFTER the cause is fixed (the email service is back, the bug fix is
// deployed). Before that, the messages just fail 3 more times and land in the DLQ again.
// A message that can never succeed (e.g. a schema version nobody handles) should not be redriven:
// it will come straight back.
// On AWS the same thing is one button: SQS console -> the DLQ -> "Start DLQ redrive" (API:
// StartMessageMoveTask). This script does it by hand so you can see the steps.

const queueUrl = env.JOBS_QUEUE_URL;
const dlqUrl = env.JOBS_DLQ_URL;
if (!queueUrl || !dlqUrl) {
  console.error("JOBS_QUEUE_URL and JOBS_DLQ_URL must both be set (see apps/worker/.env.example).");
  process.exit(1);
}
const sqs = new SQSClient({ region: env.AWS_REGION, endpoint: env.SQS_ENDPOINT });

let moved = 0;
while (true) {
  // 1. Take up to 10 messages from the DLQ. They stay hidden for 30 s while we move them.
  const result = await sqs.send(new ReceiveMessageCommand({ QueueUrl: dlqUrl, MaxNumberOfMessages: 10, WaitTimeSeconds: 1, VisibilityTimeout: 30 }));
  if (!result.Messages || result.Messages.length === 0) break;

  for (const message of result.Messages) {
    // 2. SEND FIRST, DELETE SECOND. If we crash in between, the message exists in both queues and
    //    is handled twice, which the idempotent consumer makes harmless (same booking = same
    //    jobKey). The other order could LOSE it: deleted from the DLQ, never sent.
    const sent = await sqs.send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: message.Body ?? "" }));
    await sqs.send(new DeleteMessageCommand({ QueueUrl: dlqUrl, ReceiptHandle: message.ReceiptHandle }));
    console.log(`moved ${message.MessageId} -> main queue as ${sent.MessageId}`);
    moved += 1;
  }
}
console.log(`${moved} message(s) moved back to the main queue`);

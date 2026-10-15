import { ChangeMessageVisibilityCommand, ReceiveMessageCommand, SQSClient, type Message } from "@aws-sdk/client-sqs";
import { env } from "../config";

// `pnpm jobs:dlq`: lists the messages in the dead-letter queue (DLQ), WITHOUT removing them.
//
// When to use it: when something says the DLQ is not empty (on AWS: an alarm on the DLQ's message
// count, S1c). Each line tells you which job gave up (type, bookingId) and how often it was tried.
// Then find the cause in the worker's logs by messageId or bookingId: a bug, a message version the
// worker does not know, the email service down for too long. Fix it first, then `pnpm jobs:redrive`.

const dlqUrl = env.JOBS_DLQ_URL;
if (!dlqUrl) {
  console.error("JOBS_DLQ_URL is not set (see apps/worker/.env.example).");
  process.exit(1);
}
const sqs = new SQSClient({ region: env.AWS_REGION, endpoint: env.SQS_ENDPOINT });

// 1. A queue has no "look without taking" call, so we RECEIVE the messages. Each one we receive
//    stays hidden for 30 s, so the next receive returns the NEXT messages, not the same ones again.
const seen: Message[] = [];
while (true) {
  const result = await sqs.send(
    new ReceiveMessageCommand({
      QueueUrl: dlqUrl,
      MaxNumberOfMessages: 10,
      WaitTimeSeconds: 1,
      VisibilityTimeout: 30,
      MessageSystemAttributeNames: ["ApproximateReceiveCount"],
    }),
  );
  if (!result.Messages || result.Messages.length === 0) break;
  seen.push(...result.Messages);
}

// 2. Print only safe fields. NEVER the body or the email address: we pick a few fields by name.
//    "receives" counts every delivery: the tries in the main queue, plus each time a listing
//    like this one received it (this run included).
console.log(`${seen.length} message(s) in the dead-letter queue`);
for (const message of seen) {
  const fields = safeFields(message.Body ?? "");
  console.log(
    `- type=${fields.type} version=${fields.version} messageId=${fields.messageId} bookingId=${fields.bookingId}` +
      ` receives=${message.Attributes?.ApproximateReceiveCount ?? "?"} (queue id ${message.MessageId})`,
  );
}

// 3. Put them back: visibility 0 = visible again right now, so a redrive can take them at once.
for (const message of seen) {
  await sqs.send(new ChangeMessageVisibilityCommand({ QueueUrl: dlqUrl, ReceiptHandle: message.ReceiptHandle, VisibilityTimeout: 0 }));
}

// The few fields we show. A body that is not JSON, or a field that is not plain text/number, shows "?".
function safeFields(body: string): Record<"type" | "version" | "messageId" | "bookingId", string> {
  let value: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed === "object" && parsed !== null) value = parsed as Record<string, unknown>;
  } catch {
    // not JSON: every field stays "?"
  }
  const pick = (key: string) => (typeof value[key] === "string" || typeof value[key] === "number" ? String(value[key]) : "?");
  return { type: pick("type"), version: pick("version"), messageId: pick("messageId"), bookingId: pick("bookingId") };
}

import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { SendMessageBatchCommand, SQSClient } from "@aws-sdk/client-sqs";
import type { BookingConfirmedMessage } from "@minitickets/shared";
import { env } from "../config";

// `pnpm jobs:send`: puts DEMO messages on the jobs queue, to watch the worker handle failures
// without booking through the app. Local demos only.
//   pnpm jobs:send                     one valid message
//   pnpm jobs:send --count 5 --bad 1   5 messages, the first 1 of them a "poison" (version 9)
//   pnpm jobs:send --twice             the SAME message twice (a duplicate delivery)

const { values } = parseArgs({
  options: {
    count: { type: "string", default: "1" },
    bad: { type: "string", default: "0" },
    twice: { type: "boolean", default: false },
  },
});
const count = Number(values.count);
const bad = Number(values.bad);
// SendMessageBatch takes at most 10 entries.
if (!Number.isInteger(count) || count < 1 || count > 10 || !Number.isInteger(bad) || bad < 0 || bad > count) {
  console.error("use --count 1-10 and --bad 0-<count>");
  process.exit(1);
}

const queueUrl = env.JOBS_QUEUE_URL;
if (!queueUrl) {
  console.error("JOBS_QUEUE_URL is not set (see apps/worker/.env.example).");
  process.exit(1);
}
const sqs = new SQSClient({ region: env.AWS_REGION, endpoint: env.SQS_ENDPOINT });

// 1. Build the messages. A "bad" one has version 9: valid JSON, but a version the worker does not
//    know, so it fails on every try (a poison message).
const bodies: string[] = [];
for (let i = 0; i < count; i++) {
  const message: BookingConfirmedMessage = {
    type: "booking.confirmed",
    version: 1,
    messageId: randomUUID(),
    bookingId: randomUUID(),
    userEmail: "demo@example.com",
    eventTitle: "Demo Night",
    eventVenue: "The Demo Hall",
    eventStartsAt: "2026-12-01T19:00:00.000Z",
    quantity: 1,
    occurredAt: new Date().toISOString(),
  };
  bodies.push(JSON.stringify(i < bad ? { ...message, version: 9 } : message));
}
// 2. --twice: the same body again (same messageId, same bookingId), like a duplicate delivery.
if (values.twice) bodies.push(...bodies);

// 3. One SendMessageBatch call, so they arrive together (a worker then gets them as one batch).
const result = await sqs.send(
  new SendMessageBatchCommand({ QueueUrl: queueUrl, Entries: bodies.map((MessageBody, i) => ({ Id: String(i), MessageBody })) }),
);
for (const entry of result.Successful ?? []) {
  const body = JSON.parse(bodies[Number(entry.Id)]);
  console.log(`sent queue id ${entry.MessageId}: version ${body.version}, bookingId ${body.bookingId}`);
}
for (const entry of result.Failed ?? []) console.error(`not sent (entry ${entry.Id}): ${entry.Message}`);

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DeleteTableCommand, QueryCommand } from "@aws-sdk/client-dynamodb";
import { DeleteBucketCommand, DeleteObjectsCommand, GetObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { DeleteSecretCommand } from "@aws-sdk/client-secrets-manager";
import { DeleteTopicCommand, PublishCommand } from "@aws-sdk/client-sns";
import { DeleteQueueCommand, ReceiveMessageCommand } from "@aws-sdk/client-sqs";
import type { SQSEvent, SQSBatchResponse } from "aws-lambda";
import { LocalTicketSettings, setupLocalTickets } from "../tickets/local-stack";
import { createLog } from "../log";
import { handleTicketBatch } from "../tickets/batch";
import { verifyTicket } from "../tickets/token";
import { signingSecret, ticketPngWriter } from "../tickets/assets";
import { DynamoTickets } from "../tickets/store";

// 1. One short, isolated run against real SDKs and local emulators. No .env or live AWS;
//    unique names avoid stealing work from running consumers. Cleanup only our resources.
const prefix = `p4-${randomUUID().slice(0, 8)}`;
const settings = LocalTicketSettings.parse({ TICKETS_TABLE: `${prefix}-tickets`, TICKETS_BUCKET: `${prefix}-assets`,
  TICKET_SIGNING_SECRET_ID: `${prefix}/signing` });
const stack = await setupLocalTickets(settings, prefix);
const { sqs, sns, s3, dynamo, secrets } = stack.clients;
const log = createLog({}, () => undefined);
const deps = { tickets: new DynamoTickets(dynamo, settings.TICKETS_TABLE),
  secret: signingSecret(secrets, settings.TICKET_SIGNING_SECRET_ID), writePng: ticketPngWriter(s3, settings.TICKETS_BUCKET) };
// Exercise the shipped bundle too (including the QR encoder's CommonJS dependencies).
// These are local endpoints, resource names and dummy credentials, never a signing value.
Object.assign(process.env, settings, { AWS_ACCESS_KEY_ID: "local", AWS_SECRET_ACCESS_KEY: "local" });
const entryPoint = new URL("../../dist/ticket-lambda.mjs", import.meta.url).href;
const message = { type: "booking.confirmed", version: 1, messageId: randomUUID(), bookingId: randomUUID(),
  userId: randomUUID(), eventId: randomUUID(), quantity: 4, userEmail: "demo@example.com", eventTitle: "P4 demo",
  eventVenue: "Hall", eventStartsAt: "2027-01-01T18:00:00.000Z", occurredAt: new Date().toISOString() };
try {
  const { handler }: { handler: (event: SQSEvent) => Promise<SQSBatchResponse> } = await import(entryPoint);
  await sns.send(new PublishCommand({ TopicArn: stack.topicArn, Message: JSON.stringify(message) }));
  const email = await sqs.send(new ReceiveMessageCommand({ QueueUrl: stack.email.url, WaitTimeSeconds: 1 }));
  const tickets = await sqs.send(new ReceiveMessageCommand({ QueueUrl: stack.tickets.url, WaitTimeSeconds: 1 }));
  assert.equal(email.Messages?.length, 1); assert.equal(tickets.Messages?.length, 1);
  assert.deepEqual(JSON.parse(email.Messages![0].Body!), message);
  const event = { Records: [{ messageId: tickets.Messages![0].MessageId!, body: tickets.Messages![0].Body!, attributes: {} }] } as SQSEvent;
  const failing = { ...deps, writePng: async () => { throw new Error("simulated S3 outage"); } };
  assert.equal((await handleTicketBatch(event, failing, log)).batchItemFailures.length, 1);
  // 2. Recover an interrupted reservation, race two deliveries, then replay the successful
  //    booking. Count records/assets and verify every signed token, not just an invocation.
  const results = await Promise.all([handler(event), handler(event)]);
  assert(results.every(result => result.batchItemFailures.length === 0));
  assert.equal((await handler(event)).batchItemFailures.length, 0);
  const query = await dynamo.send(new QueryCommand({ TableName: settings.TICKETS_TABLE, ConsistentRead: true,
    KeyConditionExpression: "userId = :owner", ExpressionAttributeValues: { ":owner": { S: message.userId } } }));
  assert.equal(query.Count, 4);
  let verified = 0;
  for (const ticket of query.Items!) {
    assert.equal(ticket.status.S, "ready");
    verifyTicket(ticket.qrToken.S!, await deps.secret());
    const png = await s3.send(new GetObjectCommand({ Bucket: settings.TICKETS_BUCKET, Key: ticket.objectKey.S! }));
    const bytes = await png.Body!.transformToByteArray();
    assert.equal(Buffer.from(bytes).subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.equal(png.ContentType, "image/png"); assert.equal(png.ServerSideEncryption, "AES256");
    verified++;
  }
  const objects = await s3.send(new ListObjectsV2Command({ Bucket: settings.TICKETS_BUCKET }));
  assert.equal(objects.KeyCount, 4);
  const indexed = await dynamo.send(new QueryCommand({ TableName: settings.TICKETS_TABLE, IndexName: "by-event-date",
    KeyConditionExpression: "eventDate = :date", ExpressionAttributeValues: { ":date": { S: "2027-01-01" } } }));
  assert.equal(indexed.Count, 4);
  console.log(`SNS: 1 publish -> 2 queues; S3 failure: 1 retry; concurrent + replay: 4 records, 4 PNGs, 0 extra tickets; HMAC verified: ${verified}; date GSI: ${indexed.Count}`);
} finally {
  // 3. The settings were checked as local-only before creating any client.
  const objects = await s3.send(new ListObjectsV2Command({ Bucket: settings.TICKETS_BUCKET }));
  if (objects.Contents?.length) await s3.send(new DeleteObjectsCommand({ Bucket: settings.TICKETS_BUCKET,
    Delete: { Objects: objects.Contents.map(object => ({ Key: object.Key! })) } }));
  await s3.send(new DeleteBucketCommand({ Bucket: settings.TICKETS_BUCKET }));
  await dynamo.send(new DeleteTableCommand({ TableName: settings.TICKETS_TABLE }));
  await secrets.send(new DeleteSecretCommand({ SecretId: settings.TICKET_SIGNING_SECRET_ID, ForceDeleteWithoutRecovery: true }));
  await sns.send(new DeleteTopicCommand({ TopicArn: stack.topicArn }));
  for (const queue of [stack.email, stack.tickets]) for (const QueueUrl of [queue.url, queue.dlq]) await sqs.send(new DeleteQueueCommand({ QueueUrl }));
  Object.values(stack.clients).forEach(client => client.destroy());
}

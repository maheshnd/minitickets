import { DescribeTableCommand } from "@aws-sdk/client-dynamodb";
import { GetBucketCorsCommand, GetBucketEncryptionCommand, GetBucketLifecycleConfigurationCommand, GetPublicAccessBlockCommand } from "@aws-sdk/client-s3";
import { DescribeSecretCommand } from "@aws-sdk/client-secrets-manager";
import { GetSubscriptionAttributesCommand, ListSubscriptionsByTopicCommand } from "@aws-sdk/client-sns";
import { GetQueueAttributesCommand } from "@aws-sdk/client-sqs";
import assert from "node:assert/strict";
import { LocalTicketSettings, localTicketClients } from "../tickets/local-stack";
import { env } from "../config";

// 1. Read-only emulator acceptance. No secret value is fetched, and no body/token is logged.
const settings = LocalTicketSettings.parse(process.env);
const clients = localTicketClients(settings);
try {
  assert(env.TICKETS_QUEUE_URL && env.TICKETS_DLQ_URL && env.BOOKING_EVENTS_TOPIC_ARN && env.TICKETS_TABLE
    && env.TICKETS_BUCKET && env.TICKET_SIGNING_SECRET_ID, "copy P4 settings from apps/worker/.env.example");
  const subs = (await clients.sns.send(new ListSubscriptionsByTopicCommand({ TopicArn: env.BOOKING_EVENTS_TOPIC_ARN }))).Subscriptions ?? [];
  for (const [url, dlq] of [[env.JOBS_QUEUE_URL, env.JOBS_DLQ_URL], [env.TICKETS_QUEUE_URL, env.TICKETS_DLQ_URL]]) {
    assert(url && dlq, "queue and DLQ URLs are required");
    const queue = (await clients.sqs.send(new GetQueueAttributesCommand({ QueueUrl: url, AttributeNames: ["All"] }))).Attributes!;
    const dead = (await clients.sqs.send(new GetQueueAttributesCommand({ QueueUrl: dlq, AttributeNames: ["QueueArn"] }))).Attributes!;
    const redrive = JSON.parse(queue.RedrivePolicy ?? "{}");
    assert(redrive.maxReceiveCount == 3 && redrive.deadLetterTargetArn === dead.QueueArn, "queue must redrive to its own DLQ after 3 tries");
    const sub = subs.find(sub => sub.Endpoint === queue.QueueArn);
    assert(sub?.SubscriptionArn, "queue must subscribe to the booking topic");
    const attributes = await clients.sns.send(new GetSubscriptionAttributesCommand({ SubscriptionArn: sub.SubscriptionArn }));
    assert.equal(attributes.Attributes?.RawMessageDelivery, "true", "subscription needs raw JSON delivery");
  }
  const table = (await clients.dynamo.send(new DescribeTableCommand({ TableName: settings.TICKETS_TABLE }))).Table;
  assert(table?.GlobalSecondaryIndexes?.some(index => index.IndexName === "by-event-date" && index.IndexStatus === "ACTIVE"), "active event-date GSI is required");
  const access = (await clients.s3.send(new GetPublicAccessBlockCommand({ Bucket: settings.TICKETS_BUCKET }))).PublicAccessBlockConfiguration;
  assert(access?.BlockPublicAcls && access.IgnorePublicAcls && access.BlockPublicPolicy && access.RestrictPublicBuckets, "all four S3 public access blocks are required");
  const encryption = await clients.s3.send(new GetBucketEncryptionCommand({ Bucket: settings.TICKETS_BUCKET }));
  assert.equal(encryption.ServerSideEncryptionConfiguration?.Rules?.[0].ApplyServerSideEncryptionByDefault?.SSEAlgorithm, "AES256");
  const lifecycle = await clients.s3.send(new GetBucketLifecycleConfigurationCommand({ Bucket: settings.TICKETS_BUCKET }));
  assert(lifecycle.Rules?.some(rule => rule.Status === "Enabled" && rule.AbortIncompleteMultipartUpload?.DaysAfterInitiation === 1));
  assert(lifecycle.Rules?.some(rule => rule.Filter?.Prefix === "poster-uploads/" && rule.Expiration?.Days === 1), "staged posters need one-day expiry");
  const cors = await clients.s3.send(new GetBucketCorsCommand({ Bucket: settings.TICKETS_BUCKET }));
  assert(cors.CORSRules?.some(rule => rule.AllowedOrigins?.includes(settings.WEB_ORIGIN)
    && rule.AllowedMethods?.includes("PUT")), "poster PUT CORS must allow the configured web origin");
  await clients.secrets.send(new DescribeSecretCommand({ SecretId: settings.TICKET_SIGNING_SECRET_ID }));
  console.log("P4: 2 raw subscriptions, 2 queues/DLQs, tickets table/GSI, private/SSE/lifecycle/CORS bucket, signing secret exist");
} catch {
  console.error("P4 pipeline check failed: compare .env with .env.example, then run pnpm tickets:setup (emulators must be running)");
  process.exitCode = 1;
} finally { Object.values(clients).forEach(client => client.destroy()); }

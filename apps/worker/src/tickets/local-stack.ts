import { CreateQueueCommand, GetQueueAttributesCommand, SetQueueAttributesCommand, SQSClient } from "@aws-sdk/client-sqs";
import { CreateTopicCommand, SNSClient, SubscribeCommand, ListSubscriptionsByTopicCommand } from "@aws-sdk/client-sns";
import { CreateBucketCommand, HeadBucketCommand, PutBucketEncryptionCommand, PutPublicAccessBlockCommand, PutBucketLifecycleConfigurationCommand, S3Client } from "@aws-sdk/client-s3";
import { CreateSecretCommand, DescribeSecretCommand, ResourceNotFoundException, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { CreateTableCommand, DynamoDBClient, ResourceInUseException, waitUntilTableExists } from "@aws-sdk/client-dynamodb";
import { randomBytes } from "node:crypto";
import { z } from "zod";

// 1. Every mutation here MUST target loopback emulators, with dummy credentials. Never fall
//    through to AWS if an endpoint is missing or a shell accidentally exports real settings.
const localUrl = z.url().refine(value => {
  const url = new URL(value);
  return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}, "local setup requires an HTTP loopback endpoint");
export const LocalTicketSettings = z.object({
  AWS_REGION: z.literal("us-east-1").default("us-east-1"),
  SNS_ENDPOINT: localUrl.default("http://localhost:5001"),
  SQS_ENDPOINT: localUrl.default("http://localhost:5001"),
  S3_ENDPOINT: localUrl.default("http://localhost:5001"),
  SECRETS_MANAGER_ENDPOINT: localUrl.default("http://localhost:5001"),
  DYNAMODB_ENDPOINT: localUrl.default("http://localhost:8000"),
  TICKETS_TABLE: z.string().regex(/^[a-zA-Z0-9_-]+$/).default("minitickets-tickets"),
  TICKETS_BUCKET: z.string().regex(/^[a-z0-9-]+$/).default("minitickets-ticket-assets"),
  TICKET_SIGNING_SECRET_ID: z.string().min(1).default("minitickets/local/ticket-signing"),
}).refine(e => e.SNS_ENDPOINT === e.SQS_ENDPOINT, "SNS and SQS must use the SAME Moto backend (see .env.example)");
export type LocalTicketSettings = z.infer<typeof LocalTicketSettings>;

export function localTicketClients(settings: LocalTicketSettings) {
  const common = { region: settings.AWS_REGION, credentials: { accessKeyId: "local", secretAccessKey: "local" },
    maxAttempts: 1, requestHandler: { connectionTimeout: 1000, requestTimeout: 3000, throwOnRequestTimeout: true } };
  return { sqs: new SQSClient({ ...common, endpoint: settings.SQS_ENDPOINT }),
    sns: new SNSClient({ ...common, endpoint: settings.SNS_ENDPOINT }),
    s3: new S3Client({ ...common, endpoint: settings.S3_ENDPOINT, forcePathStyle: true }),
    secrets: new SecretsManagerClient({ ...common, endpoint: settings.SECRETS_MANAGER_ENDPOINT }),
    dynamo: new DynamoDBClient({ ...common, endpoint: settings.DYNAMODB_ENDPOINT }) };
}

export async function setupLocalTickets(settings: LocalTicketSettings, prefix = "minitickets") {
  const clients = localTicketClients(settings);
  const { sqs, sns, s3, secrets, dynamo } = clients;
  // 2. Repeated setup preserves messages, QR objects and signing keys. Separate queue DLQs,
  //    same raw JSON contract as Pulumi. Moto handles SNS/SQS delivery inside one backend.
  const topicArn = (await sns.send(new CreateTopicCommand({ Name: `${prefix}-booking-events` }))).TopicArn!;
  const subscriptions = (await sns.send(new ListSubscriptionsByTopicCommand({ TopicArn: topicArn }))).Subscriptions ?? [];
  const queues: { url: string; dlq: string }[] = [];
  for (const kind of ["jobs", "tickets"]) {
    const dlq = (await sqs.send(new CreateQueueCommand({ QueueName: `${prefix}-${kind}-dlq`,
      Attributes: { MessageRetentionPeriod: "1209600" } }))).QueueUrl!;
    const dlqArn = (await sqs.send(new GetQueueAttributesCommand({ QueueUrl: dlq, AttributeNames: ["QueueArn"] }))).Attributes!.QueueArn;
    const url = (await sqs.send(new CreateQueueCommand({ QueueName: `${prefix}-${kind}`, Attributes: {
      VisibilityTimeout: kind === "tickets" ? "180" : "60", MessageRetentionPeriod: "345600",
      RedrivePolicy: JSON.stringify({ deadLetterTargetArn: dlqArn, maxReceiveCount: 3 }),
    } }))).QueueUrl!;
    const arn = (await sqs.send(new GetQueueAttributesCommand({ QueueUrl: url, AttributeNames: ["QueueArn"] }))).Attributes!.QueueArn;
    await sqs.send(new SetQueueAttributesCommand({ QueueUrl: url, Attributes: { Policy: JSON.stringify({
      Version: "2012-10-17", Statement: [{ Effect: "Allow", Principal: { Service: "sns.amazonaws.com" },
        Action: "sqs:SendMessage", Resource: arn, Condition: { ArnEquals: { "aws:SourceArn": topicArn } } }],
    }) } }));
    if (!subscriptions.some(s => s.Endpoint === arn)) await sns.send(new SubscribeCommand({ TopicArn: topicArn,
      Protocol: "sqs", Endpoint: arn, Attributes: { RawMessageDelivery: "true" } }));
    queues.push({ url, dlq });
  }
  // 3. The same owner lookup and UTC-date GSI keys as AWS. DynamoDB Local is in memory;
  //    rerun this setup after it restarts. No TTL: future events must retain their tickets.
  try {
    await dynamo.send(new CreateTableCommand({ TableName: settings.TICKETS_TABLE, BillingMode: "PAY_PER_REQUEST",
      AttributeDefinitions: ["userId", "ticketId", "eventDate", "eventDateKey"].map(AttributeName => ({ AttributeName, AttributeType: "S" })),
      KeySchema: [{ AttributeName: "userId", KeyType: "HASH" }, { AttributeName: "ticketId", KeyType: "RANGE" }],
      GlobalSecondaryIndexes: [{ IndexName: "by-event-date", KeySchema: [{ AttributeName: "eventDate", KeyType: "HASH" },
        { AttributeName: "eventDateKey", KeyType: "RANGE" }], Projection: { ProjectionType: "ALL" } }],
    }));
  } catch (err) { if (!(err instanceof ResourceInUseException)) throw err; }
  await waitUntilTableExists({ client: dynamo, maxWaitTime: 20, minDelay: 1, maxDelay: 2 }, { TableName: settings.TICKETS_TABLE });
  try { await s3.send(new HeadBucketCommand({ Bucket: settings.TICKETS_BUCKET })); }
  catch (err) {
    if (!(err instanceof Error) || !("$metadata" in err) || (err.$metadata as { httpStatusCode?: number }).httpStatusCode !== 404) throw err;
    await s3.send(new CreateBucketCommand({ Bucket: settings.TICKETS_BUCKET }));
  }
  await s3.send(new PutPublicAccessBlockCommand({ Bucket: settings.TICKETS_BUCKET,
    PublicAccessBlockConfiguration: { BlockPublicAcls: true, IgnorePublicAcls: true, BlockPublicPolicy: true, RestrictPublicBuckets: true } }));
  await s3.send(new PutBucketEncryptionCommand({ Bucket: settings.TICKETS_BUCKET,
    ServerSideEncryptionConfiguration: { Rules: [{ ApplyServerSideEncryptionByDefault: { SSEAlgorithm: "AES256" } }] } }));
  await s3.send(new PutBucketLifecycleConfigurationCommand({ Bucket: settings.TICKETS_BUCKET,
    LifecycleConfiguration: { Rules: [{ ID: "abort-incomplete-ticket-uploads", Status: "Enabled", Filter: { Prefix: "tickets/" },
      AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 } }] } }));
  try { await secrets.send(new DescribeSecretCommand({ SecretId: settings.TICKET_SIGNING_SECRET_ID })); }
  catch (err) {
    if (!(err instanceof ResourceNotFoundException)) throw err;
    await secrets.send(new CreateSecretCommand({ Name: settings.TICKET_SIGNING_SECRET_ID, SecretString: randomBytes(32).toString("hex") }));
  }
  return { clients, topicArn, email: queues[0], tickets: queues[1] };
}

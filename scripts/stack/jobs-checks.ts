import { createRequire } from "node:module";
import path from "node:path";
import { ROOT, type EnvValues } from "./env-files.ts";
import { isPortOpen } from "./net.ts";
import type { CheckResult } from "./results.ts";

// Checks the background-jobs side: the jobs queue and its dead-letter queue (ElasticMQ, speaks the
// SQS API) and the processed-jobs table (DynamoDB Local). It uses the same AWS SDK packages as the
// worker, loaded from apps/worker (createRequire, as in data-checks.ts).
//
// SAFETY: it only ever talks to an endpoint on THIS machine. Without SQS_ENDPOINT /
// DYNAMODB_ENDPOINT the SDK would call real AWS, so then the check is skipped.

// 1. The few SDK shapes used here. `send` returns what the command returns; we read only the
//    fields named below.
type AwsClientConfig = {
  region: string;
  endpoint: string;
  credentials: { accessKeyId: string; secretAccessKey: string };
  maxAttempts: number;
};
type AwsClient = { send<Output>(command: object): Promise<Output>; destroy(): void };
type SqsModule = {
  SQSClient: new (config: AwsClientConfig) => AwsClient;
  GetQueueAttributesCommand: new (input: { QueueUrl: string; AttributeNames: string[] }) => object;
};
type DynamoModule = {
  DynamoDBClient: new (config: AwsClientConfig) => AwsClient;
  DescribeTableCommand: new (input: { TableName: string }) => object;
  DescribeTimeToLiveCommand: new (input: { TableName: string }) => object;
};

const requireFromWorker = createRequire(path.join(ROOT, "apps/worker/package.json"));
const RESTART_QUEUE = "docker compose restart queue   (it re-reads docker/elasticmq.conf; messages waiting in it are lost)";

function isLocal(url: URL): boolean {
  return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}

// 2. Dummy credentials: the SDK insists on some; ElasticMQ and DynamoDB Local ignore them.
function clientConfig(endpoint: string, region: string): AwsClientConfig {
  return { region, endpoint, credentials: { accessKeyId: "local", secretAccessKey: "local" }, maxAttempts: 1 };
}

// 3. The queue name is the last part of its URL (and of its ARN).
const nameOf = (urlOrArn: string) => urlOrArn.split(/[/:]/).at(-1) ?? urlOrArn;

// 4. The jobs queue and its dead-letter queue. The worker's .env has both URLs; the api's has the
//    main one (env-checks.ts already made sure the two agree).
export async function checkQueues(worker: EnvValues, api: EnvValues): Promise<CheckResult[]> {
  const queueUrl = worker.JOBS_QUEUE_URL ?? api.JOBS_QUEUE_URL;
  const dlqUrl = worker.JOBS_DLQ_URL;
  const endpoint = worker.SQS_ENDPOINT ?? api.SQS_ENDPOINT;
  if (!queueUrl || !endpoint || !isLocal(new URL(endpoint))) {
    return [{ status: "warn", title: "queue: skipped (needs JOBS_QUEUE_URL and a local SQS_ENDPOINT in apps/worker/.env)" }];
  }
  const where = new URL(endpoint);
  const setupQueue = where.port === "5001" ? "pnpm tickets:setup" : RESTART_QUEUE;
  if (!(await isPortOpen(where.hostname, Number(where.port)))) {
    return [{ status: "fail", title: `queue: nothing listens on ${where.host}`, fix: ["pnpm db:up"] }];
  }

  const { SQSClient, GetQueueAttributesCommand } = requireFromWorker("@aws-sdk/client-sqs") as SqsModule;
  const sqs = new SQSClient(clientConfig(endpoint, worker.AWS_REGION ?? "us-east-1"));
  const attributesOf = (QueueUrl: string) =>
    sqs
      .send<{ Attributes?: Record<string, string> }>(new GetQueueAttributesCommand({ QueueUrl, AttributeNames: ["All"] }))
      .then((r) => r.Attributes ?? {})
      .catch(() => undefined); // undefined = the queue does not exist
  try {
    const results: CheckResult[] = [];

    // 4a. The main queue must exist and send failed messages to the dead-letter queue after 3
    //     tries (its "redrive policy"). A queue without one comes from a container that was started
    //     before docker/elasticmq.conf had the DLQ (S1b): ElasticMQ reads that file only at startup.
    const main = await attributesOf(queueUrl);
    if (!main) return [{ status: "fail", title: `queue ${nameOf(queueUrl)} does not exist`, fix: [setupQueue] }];
    const redrive = main.RedrivePolicy ? (JSON.parse(main.RedrivePolicy) as { deadLetterTargetArn: string; maxReceiveCount: number }) : undefined;
    const counts = `${main.ApproximateNumberOfMessages ?? "?"} waiting, ${main.ApproximateNumberOfMessagesNotVisible ?? "?"} being handled`;
    if (!redrive) {
      return [{
        status: "fail",
        title: `queue ${nameOf(queueUrl)} has no dead-letter queue (${counts})`,
        detail: ["the container started before docker/elasticmq.conf had one; a poison message would come back forever"],
        fix: [setupQueue],
      }];
    }
    results.push({
      status: "ok",
      title: `queue ${nameOf(queueUrl)}: ${counts}; after ${redrive.maxReceiveCount} tries -> ${nameOf(redrive.deadLetterTargetArn)}`,
    });

    // 4b. The dead-letter queue: exists, is the one the redrive policy names, and is empty.
    //     Messages there are failures nobody looked at yet: a warning, not an error.
    if (!dlqUrl) return results;
    const dlq = await attributesOf(dlqUrl);
    if (!dlq) {
      results.push({ status: "fail", title: `dead-letter queue ${nameOf(dlqUrl)} does not exist`, fix: [setupQueue] });
    } else if (nameOf(dlqUrl) !== nameOf(redrive.deadLetterTargetArn)) {
      results.push({
        status: "fail",
        title: `JOBS_DLQ_URL is ${nameOf(dlqUrl)}, but the queue sends failures to ${nameOf(redrive.deadLetterTargetArn)}`,
        fix: ["fix JOBS_DLQ_URL in apps/worker/.env (see apps/worker/.env.example)"],
      });
    } else if (Number(dlq.ApproximateNumberOfMessages ?? "0") > 0) {
      results.push({
        status: "warn",
        title: `dead-letter queue ${nameOf(dlqUrl)}: ${dlq.ApproximateNumberOfMessages} failed message(s)`,
        fix: ["pnpm jobs:dlq       (look at them)", "pnpm jobs:redrive   (send them back, after fixing the cause)"],
      });
    } else {
      results.push({ status: "ok", title: `dead-letter queue ${nameOf(dlqUrl)}: empty` });
    }
    return results;
  } finally {
    sqs.destroy();
  }
}

// 5. The processed-jobs table (the worker's duplicate check). DynamoDB Local runs IN MEMORY, so
//    every start of its container begins with no tables at all: this is the check that catches it.
export async function checkProcessedJobsTable(worker: EnvValues): Promise<CheckResult> {
  const endpoint = worker.DYNAMODB_ENDPOINT;
  const TableName = worker.PROCESSED_JOBS_TABLE ?? "minitickets-processed-jobs";
  if (!endpoint || !isLocal(new URL(endpoint))) {
    return { status: "warn", title: "table: skipped (needs a local DYNAMODB_ENDPOINT in apps/worker/.env)" };
  }
  const where = new URL(endpoint);
  if (!(await isPortOpen(where.hostname, Number(where.port)))) {
    return { status: "fail", title: `dynamodb: nothing listens on ${where.host}`, fix: ["pnpm db:up", "pnpm jobs:table"] };
  }

  const { DynamoDBClient, DescribeTableCommand, DescribeTimeToLiveCommand } = requireFromWorker("@aws-sdk/client-dynamodb") as DynamoModule;
  const dynamo = new DynamoDBClient(clientConfig(endpoint, worker.AWS_REGION ?? "us-east-1"));
  try {
    try {
      await dynamo.send(new DescribeTableCommand({ TableName }));
    } catch {
      return {
        status: "fail",
        title: `table ${TableName} does not exist`,
        detail: ["DynamoDB Local keeps its tables in memory: each container (re)start empties it"],
        fix: ["pnpm jobs:table   (pnpm dev runs it for you)"],
      };
    }
    const ttl = await dynamo.send<{ TimeToLiveDescription?: { TimeToLiveStatus?: string; AttributeName?: string } }>(
      new DescribeTimeToLiveCommand({ TableName }),
    );
    if (ttl.TimeToLiveDescription?.TimeToLiveStatus !== "ENABLED") {
      return { status: "fail", title: `table ${TableName}: TTL is off (old records would never expire)`, fix: ["pnpm jobs:table"] };
    }
    return { status: "ok", title: `table ${TableName}: exists, TTL on ${ttl.TimeToLiveDescription.AttributeName}` };
  } finally {
    dynamo.destroy();
  }
}

// LAYER: jobs / queues (S1c)
// NEEDS (inputs):   nothing
// CREATES:          SQS queue minitickets-dev-jobs, its dead-letter queue minitickets-dev-jobs-dlq,
//                   and a redrive-allow policy (only our queue may use that DLQ)
// GIVES (outputs):  queueArn  -> compute/iam (api may SendMessage), jobs/worker-iam (Lambda reads),
//                                jobs/queue-trigger (Lambda's event source)
//                   queueUrl  -> compute/task (api's JOBS_QUEUE_URL), jobs/worker-lambda (backoff)
//                   dlqUrl    -> stack output (look at failed messages)
//                   queueName, dlqName -> observability (alarms + dashboard name the queues, P2)
//
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { tagsFor } from "../tags";
import { WORKER_TIMEOUT_SECONDS } from "./worker-lambda";

// The queues of the job pipeline: the AWS version of the two ElasticMQ queues in
// docker/elasticmq.conf. Same code talks to both (only the endpoint differs locally).
// Always on: a queue costs nothing while nobody sends or reads (billed per request).
//
//   api ── SendMessage ──▶ minitickets-dev-jobs ── Lambda reads (batches of 10) ──▶ worker
//                                │ a message received 3 times without being deleted
//                                ▼
//                          minitickets-dev-jobs-dlq   (a person looks: pnpm jobs:dlq, or the console)

const prefix = "minitickets-dev";

// 1. Days -> seconds, for readability below.
const DAY = 24 * 60 * 60;

export interface JobQueuesOutputs {
  queueName: pulumi.Output<string>;
  dlqName: pulumi.Output<string>;
  queueArn: pulumi.Output<string>;
  queueUrl: pulumi.Output<string>;
  dlqArn: pulumi.Output<string>;
  dlqUrl: pulumi.Output<string>;
}

// @concept: sqs
// @concept: dead-letter-queue
export function createJobQueues(): JobQueuesOutputs {
  // 2. The dead-letter queue (DLQ): where a message goes after too many failed tries. Nothing reads
  //    it automatically; a person lists it, fixes the cause, then moves the messages back
  //    ("Start DLQ redrive" in the console, or apps/worker's jobs:redrive locally).
  //    messageRetentionSeconds 14 days (the SQS maximum): time to notice and fix. It must be LONGER
  //      than the main queue's: in a standard queue a message's age counts from when it was FIRST
  //      sent, not from when it reached the DLQ, so a DLQ that keeps messages for less time than the
  //      main queue could delete them the moment they arrive.
  //    sqsManagedSseEnabled: encryption at rest with a key SQS manages (SSE-SQS). Free, and nobody
  //      needs a KMS permission to use the queue. A customer managed KMS key would add key
  //      policies and a monthly key fee, for no gain in dev.
  // DEPENDS ON: nothing.
  const dlq = new aws.sqs.Queue(`${prefix}-jobs-dlq`, {
    name: `${prefix}-jobs-dlq`,
    messageRetentionSeconds: 14 * DAY,
    sqsManagedSseEnabled: true,
    tags: tagsFor(`${prefix}-jobs-dlq`),
  });

  // 3. The main jobs queue.
  //    visibilityTimeoutSeconds 60: how long a received message stays hidden while the worker is
  //      busy with it. AWS's rule for a Lambda reader: at least 6 x the function's timeout (10 s,
  //      worker-lambda.ts), because Lambda may retry a THROTTLED invoke of the same batch within
  //      that time; a shorter timeout lets the message reappear while it is still being handled,
  //      and the email goes out twice. (Failed messages get a SHORTER, growing wait from the
  //      handler itself: 10 s, 40 s, 120 s, apps/worker/src/retry-later.ts.)
  //    messageRetentionSeconds 4 days (the SQS default, written out): a message nobody handles for
  //      4 days is deleted. Long enough for a weekend with the worker broken.
  //    receiveWaitTimeSeconds 20: long polling by default for any reader (Lambda long-polls anyway).
  //    redrivePolicy maxReceiveCount 3: on the 4th delivery SQS moves the message to the DLQ (2)
  //      instead. With the backoff that is about 10 + 40 + 120 s after the first failure.
  //    sqsManagedSseEnabled: as for the DLQ (2).
  // DEPENDS ON: dlq (its ARN is in the redrive policy).
  const visibilityTimeoutSeconds = 6 * WORKER_TIMEOUT_SECONDS;
  const queue = new aws.sqs.Queue(`${prefix}-jobs`, {
    name: `${prefix}-jobs`,
    visibilityTimeoutSeconds,
    messageRetentionSeconds: 4 * DAY,
    receiveWaitTimeSeconds: 20,
    sqsManagedSseEnabled: true,
    redrivePolicy: pulumi.jsonStringify({ deadLetterTargetArn: dlq.arn, maxReceiveCount: 3 }),
    tags: tagsFor(`${prefix}-jobs`),
  });

  // 4. Redrive ALLOW policy, on the DLQ: which queues may use it as their DLQ. "byQueue" + our one
  //    queue: no other queue in the account can dump its failures here by mistake (it would mix
  //    unrelated messages into the list a person reads, and into a later redrive).
  //    A separate resource because of a circle: the queue (3) names the DLQ, and this names the queue.
  // DEPENDS ON: dlq and queue.
  new aws.sqs.RedriveAllowPolicy(`${prefix}-jobs-dlq-allow`, {
    queueUrl: dlq.url,
    redriveAllowPolicy: pulumi.jsonStringify({ redrivePermission: "byQueue", sourceQueueArns: [queue.arn] }),
  });

  return { queueName: queue.name, dlqName: dlq.name, queueArn: queue.arn, queueUrl: queue.url, dlqArn: dlq.arn, dlqUrl: dlq.url };
}

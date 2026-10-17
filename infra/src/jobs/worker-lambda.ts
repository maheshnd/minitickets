// LAYER: jobs / worker Lambda (S1c, compute switch)
// NEEDS (inputs):   image          <- registry workerRepoUrl + the worker image tag (image-tag.ts)
//                   roleArn        <- jobs/worker-iam
//                   logGroupName   <- compute/logs ("worker")
//                   queueUrl       <- jobs/queues (JOBS_QUEUE_URL: the handler's backoff needs it)
//                   tableName      <- jobs/processed-jobs-table
//                   mailFrom       <- jobs/email (OPTIONAL: none = the LogMailer, no real email)
//                   reservedConcurrency <- config workerReservedConcurrency (OPTIONAL, see 2e)
// CREATES:          Lambda function minitickets-dev-worker (container image, arm64)
// GIVES (outputs):  functionArn, functionName -> jobs/queue-trigger, stack output, cd.yml checks
//
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { tagsFor } from "../tags";
import { prefix } from "../stack";

// The worker as an AWS Lambda function: AWS starts it when there are messages, runs one batch per
// call, and bills only the milliseconds it runs. No server, nothing running (or billed) while idle.
// The code is apps/worker/src/lambda.ts, the same handler `pnpm worker:dev` runs locally.

// 1. The function's timeout. queues.ts sets the queue's visibility timeout to 6 x this, so the
//    two always change together.
export const WORKER_TIMEOUT_SECONDS = 10;

export interface WorkerLambdaInputs {
  image: pulumi.Input<string>;
  roleArn: pulumi.Input<string>;
  logGroupName: pulumi.Input<string>;
  queueUrl: pulumi.Input<string>;
  tableName: pulumi.Input<string>;
  mailFrom?: string;
  reservedConcurrency?: number;
}

export interface WorkerLambdaOutputs {
  functionArn: pulumi.Output<string>;
  functionName: pulumi.Output<string>;
}

// @concept: aws-lambda
export function createWorkerLambda(inputs: WorkerLambdaInputs): WorkerLambdaOutputs {
  const fn = new aws.lambda.Function(`${prefix}-worker`, {
    name: `${prefix}-worker`,
    description: "Booking confirmation emails: reads the jobs queue (S1c)",

    // 2a. A CONTAINER IMAGE (apps/worker/Dockerfile), not a zip. The same build-once-promote path
    //     as api and web: CD builds it, tags it with the git SHA, and this line picks the tag.
    //     The other way, a zip of the bundle, would be smaller and start a little faster, but would
    //     need its own upload path (S3 or a direct upload) and versioning next to ECR's.
    packageType: "Image",
    imageUri: inputs.image,

    // @concept: arm64-graviton
    // 2b. arm64 (Graviton), like the ECS tasks: about 20% cheaper per GB-second than x86 on Lambda,
    //     and the image is built for arm64 (a mismatch fails at start with "exec format error").
    architectures: ["arm64"],

    role: inputs.roleArn,

    // 2c. Size and time limit.
    //     memorySize 256 MB: Lambda gives CPU in proportion to memory. Our handler waits on network
    //       calls (DynamoDB, SES) and holds a few KB per message; 128 MB would do, 256 MB starts
    //       faster (more CPU for the cold start) for a tiny cost difference.
    //     timeout 10 s: one batch is at most 10 messages x (2 DynamoDB calls + 1 SES call), each
    //       call limited to 3 s by the SDK timeouts (lambda.ts step 1). Normal batches take well
    //       under a second. A run that hits 10 s is cut off: the whole batch counts as failed and
    //       comes back after the queue's visibility timeout (60 s, queues.ts).
    memorySize: 256,
    timeout: WORKER_TIMEOUT_SECONDS,

    // 2d. NO vpcConfig: the function runs OUTSIDE our VPC, on purpose.
    //     It only talks to AWS's public APIs (SQS, DynamoDB, SES) and never to Postgres or Valkey:
    //       every fact the email needs travels IN the message (S1a). Outside the VPC it reaches
    //       those APIs directly over AWS's network.
    //     Inside the VPC it would get only private IPs, and our VPC has no NAT gateway (about $33 a
    //       month each) and no "interface" VPC endpoints for SQS and SES (about $7 a month each, per
    //       AZ; only DynamoDB has a free "gateway" endpoint): it could reach nothing, and adding
    //       them costs more than the whole dev environment's idle bill.
    //     It also needs no security group rule anywhere: nothing connects TO it.

    // 2e. Reserved concurrency: a fixed number of parallel copies set aside for this function
    //     (and also its upper limit). NOT set by default, because THIS ACCOUNT CAN'T YET: its
    //     Lambda quota is 10 parallel runs in total (new accounts start low; `aws lambda
    //     get-account-settings`), and AWS refuses any reservation that leaves fewer than 10
    //     unreserved. -1 = no reservation (the AWS default).
    //     The limit that matters for a queue is on the event source mapping instead (max 5
    //     parallel batches, queue-trigger.ts), so the worker is capped at 5 anyway.
    //     After asking AWS for a higher quota (Service Quotas -> Lambda -> "Concurrent
    //     executions"): pulumi config set workerReservedConcurrency 5, commit, deploy.
    reservedConcurrentExecutions: inputs.reservedConcurrency ?? -1,

    // 2f. Settings for apps/worker/src/config.ts (validated there at start). Nothing secret.
    //     AWS_REGION is set by Lambda itself (reserved; we may not set it). No *_ENDPOINT values:
    //     unset = the SDK talks to the real AWS services.
    environment: {
      variables: {
        NODE_ENV: "production",
        JOBS_QUEUE_URL: inputs.queueUrl,
        PROCESSED_JOBS_TABLE: inputs.tableName,
        ...(inputs.mailFrom ? { MAILER: "ses", MAIL_FROM: inputs.mailFrom } : { MAILER: "log" }),
      },
    },

    // @concept: cloudwatch-logs
    // 2g. Logs go to OUR log group /minitickets/dev/worker (7-day retention, compute/logs.ts), not to
    //     the default /aws/lambda/<name>, which Lambda would create itself with NO retention (kept
    //     forever, billed forever). Text format: the handler's lines as they are. Since P2 those lines
    //     are JSON written straight to stdout (apps/worker/src/log.ts), so they arrive as pure JSON
    //     and Logs Insights reads their fields; only console.* output would get Lambda's text prefix.
    //     ("JSON" format would wrap console output in Lambda's own JSON instead; not needed.)
    loggingConfig: { logFormat: "Text", logGroup: inputs.logGroupName },

    tags: tagsFor(`${prefix}-worker`),
  });

  return { functionArn: fn.arn, functionName: fn.name };
}

// LAYER: jobs / queue trigger (S1c, compute switch)
// NEEDS (inputs):   queueArn     <- jobs/queues (where to read)
//                   functionArn  <- jobs/worker-lambda (whom to call)
// CREATES:          Lambda event source mapping: jobs queue -> worker function
// GIVES (outputs):  mappingId -> stack output (to look it up with the CLI)
//
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { tagsFor } from "../tags";

// The EVENT SOURCE MAPPING: the part of Lambda that reads the queue for us. Pollers run by AWS
// long-poll the queue, collect a batch, call our function with it, and then act on the answer:
//
//   SQS jobs queue ──▶ AWS pollers ──▶ worker(batch of up to 10) ──▶ { batchItemFailures: [...] }
//                                                                      │
//        delete every message NOT in the list ◀────────────────────────┘
//        (the listed ones stay; the handler already set their retry wait)
//
// Locally apps/worker/src/local.ts plays this part.

const prefix = "minitickets-dev";

export interface QueueTriggerInputs {
  queueArn: pulumi.Input<string>;
  functionArn: pulumi.Input<string>;
}

// @concept: aws-lambda
export function createQueueTrigger(inputs: QueueTriggerInputs): { mappingId: pulumi.Output<string> } {
  // 1. The mapping.
  //    batchSize 10: up to 10 messages per call (the most SQS returns in one receive). Fewer calls
  //      (cheaper), and one slow message shares the call with 9 others; batch.ts handles them one
  //      by one, and partial failures (2) keep a bad one from failing the rest.
  //    functionResponseTypes ReportBatchItemFailures: Lambda READS our answer's batchItemFailures
  //      and deletes only the other messages. WITHOUT this line it ignores the answer: a normal
  //      return means "all done", so failed messages would be deleted too (lost emails), and only
  //      a thrown error would retry, but then the WHOLE batch, good messages included.
  //    scalingConfig.maximumConcurrency 5: at most 5 batches in parallel, so at most 5 copies of
  //      the function, which protects DynamoDB, SES (sandbox: 1 email per second) and the account's
  //      Lambda quota (10). WHY here and not with reserved concurrency: with only a reservation,
  //      the pollers can still fetch MORE batches than allowed copies; those calls are throttled,
  //      the messages go back to the queue, and each such return counts as a delivery: healthy
  //      messages could reach the DLQ without ever being handled. maximumConcurrency makes the
  //      pollers fetch only as much as can run.
  //    enabled true: reading starts as soon as the mapping exists.
  // DEPENDS ON: the function (and through its role: the permission to read the queue).
  const mapping = new aws.lambda.EventSourceMapping(`${prefix}-worker-trigger`, {
    eventSourceArn: inputs.queueArn,
    functionName: inputs.functionArn,
    batchSize: 10,
    functionResponseTypes: ["ReportBatchItemFailures"],
    scalingConfig: { maximumConcurrency: 5 },
    enabled: true,
    tags: tagsFor(`${prefix}-worker-trigger`),
  });

  return { mappingId: mapping.uuid };
}

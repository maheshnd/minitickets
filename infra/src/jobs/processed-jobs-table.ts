// LAYER: jobs / processed-jobs table (S1c)
// NEEDS (inputs):   nothing
// CREATES:          DynamoDB table minitickets-dev-processed-jobs (on demand, TTL on expiresAt)
// GIVES (outputs):  tableName -> jobs/worker-lambda (PROCESSED_JOBS_TABLE)
//                   tableArn  -> jobs/worker-iam (the Lambda may GetItem / PutItem on it only)
//
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { tagsFor } from "../tags";

// The worker's memory of which jobs are DONE (the "idempotent consumer",
// apps/worker/src/processed-jobs.ts): the AWS version of the table that `pnpm jobs:table` creates in
// DynamoDB Local. Same key, same TTL attribute, so the same code works on both.
// Always on: an on-demand table costs nothing while idle (only its few KB of storage).

const prefix = "minitickets-dev";

export interface ProcessedJobsTableOutputs {
  tableName: pulumi.Output<string>;
  tableArn: pulumi.Output<string>;
}

// @concept: dynamodb
// @concept: idempotency
export function createProcessedJobsTable(): ProcessedJobsTableOutputs {
  // 1. The table.
  //    hashKey "jobKey" (a string, "S"): the partition key. Every item is found by it, and two
  //      items can't share one; the worker's conditional put (attribute_not_exists(jobKey)) relies
  //      on that. DynamoDB has no other fixed columns: doneAt and expiresAt are just attributes.
  //    billingMode PAY_PER_REQUEST ("on demand"): no capacity to plan, pay per read and write
  //      (about $0.125 per million reads, $0.625 per million writes in us-east-1 at the time of
  //      writing). One email = 1 consistent read + 1 write. The other mode, PROVISIONED, bills
  //      reserved capacity every hour, used or not.
  //    ttl expiresAt: DynamoDB deletes an item some time AFTER the Unix time in its expiresAt
  //      attribute (usually within a few days; AWS promises no exact time). The worker sets it 30
  //      days ahead: far longer than a message can live in the queue (4 days) or the DLQ (14).
  //      Deleting by TTL is free (no write cost).
  //    Encryption at rest: always on in DynamoDB, with an AWS owned key (free, nothing to set).
  //    pointInTimeRecovery: off. A lost table only means a possible duplicate email; backups would
  //      cost money for data we can do without. Production would weigh that differently.
  //    deletionProtectionEnabled: off in dev, so the stack can be removed in one go.
  // DEPENDS ON: nothing.
  const table = new aws.dynamodb.Table(`${prefix}-processed-jobs`, {
    name: `${prefix}-processed-jobs`,
    billingMode: "PAY_PER_REQUEST",
    hashKey: "jobKey",
    attributes: [{ name: "jobKey", type: "S" }],
    ttl: { attributeName: "expiresAt", enabled: true },
    pointInTimeRecovery: { enabled: false },
    deletionProtectionEnabled: false,
    tags: tagsFor(`${prefix}-processed-jobs`),
  });

  return { tableName: table.name, tableArn: table.arn };
}

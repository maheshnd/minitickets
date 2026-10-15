import { ConditionalCheckFailedException, GetItemCommand, PutItemCommand, type DynamoDBClient } from "@aws-sdk/client-dynamodb";

// The worker's memory of which jobs are DONE: the store behind the "idempotent consumer"
// (see handlers/booking-confirmed.ts). The handler only knows this interface, so tests pass a
// fake, and only this file knows about DynamoDB.
export interface ProcessedJobs {
  // Has this job already been done (by any worker, at any time in the last 30 days)?
  isDone(jobKey: string): Promise<boolean>;
  // Remember that this job is done. "already-recorded" means someone else recorded it first.
  markDone(jobKey: string): Promise<"recorded" | "already-recorded">;
}

// How long we remember a job. DynamoDB's TTL (time to live) feature deletes an item some time
// after the Unix time in its "expiresAt" attribute (AWS: usually within a few days, not at the
// exact second). 30 days is far longer than a message can stay in a queue (SQS: 14 days at most),
// so any duplicate delivery still finds the record.
const REMEMBER_DAYS = 30;

// The table: one item per finished job. Partition key "jobKey" (text). Created locally by
// `pnpm jobs:table` (src/scripts/create-table.ts), on AWS by Pulumi
// (infra/src/jobs/processed-jobs-table.ts, same key and TTL attribute).
export class DynamoProcessedJobs implements ProcessedJobs {
  private readonly client: Pick<DynamoDBClient, "send">;
  private readonly tableName: string;

  constructor(client: Pick<DynamoDBClient, "send">, tableName: string) {
    this.client = client;
    this.tableName = tableName;
  }

  async isDone(jobKey: string): Promise<boolean> {
    // 1. Read the item by its key. ConsistentRead: DynamoDB's default read may be a moment
    //    behind the latest write; a consistent read always sees it. We want "was it JUST done
    //    by another worker?" answered correctly, so we pay for the stronger read.
    const result = await this.client.send(
      new GetItemCommand({ TableName: this.tableName, Key: { jobKey: { S: jobKey } }, ConsistentRead: true }),
    );
    return result.Item !== undefined;
  }

  async markDone(jobKey: string): Promise<"recorded" | "already-recorded"> {
    const nowSeconds = Math.floor(Date.now() / 1000);
    try {
      // 2. CONDITIONAL PUT: write the item ONLY IF no item with this key exists yet
      //    ("attribute_not_exists(jobKey)"). DynamoDB checks the condition and writes in one
      //    step, so of two workers recording the same job at the same moment, exactly one wins.
      //    A plain put would silently overwrite, and nobody would know there was a race.
      //    Every attribute value is written with its type: S = string, N = number (sent as text).
      await this.client.send(
        new PutItemCommand({
          TableName: this.tableName,
          Item: {
            jobKey: { S: jobKey },
            doneAt: { S: new Date(nowSeconds * 1000).toISOString() },
            expiresAt: { N: String(nowSeconds + REMEMBER_DAYS * 24 * 60 * 60) },
          },
          ConditionExpression: "attribute_not_exists(jobKey)",
        }),
      );
      return "recorded";
    } catch (err) {
      // 3. The condition failed: another worker recorded this job first. Not an error for us.
      if (err instanceof ConditionalCheckFailedException) return "already-recorded";
      throw err;
    }
  }
}

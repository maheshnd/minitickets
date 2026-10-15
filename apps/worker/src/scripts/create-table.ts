import {
  CreateTableCommand,
  DescribeTimeToLiveCommand,
  DynamoDBClient,
  ResourceInUseException,
  UpdateTimeToLiveCommand,
} from "@aws-sdk/client-dynamodb";
import { env } from "../config";

// `pnpm jobs:table`: creates the processed-jobs table in DynamoDB LOCAL. Run it once after
// `pnpm db:up`: DynamoDB Local keeps its data in memory, so a new or restarted container starts
// empty. Safe to run again (it skips what already exists). On AWS the table comes from Pulumi
// (infra/src/jobs/processed-jobs-table.ts), never from this script.

// 1. Refuse to run without a local endpoint: without one, the SDK would talk to REAL AWS.
if (!env.DYNAMODB_ENDPOINT) {
  console.error("DYNAMODB_ENDPOINT is not set. This script is for DynamoDB Local only (see apps/worker/.env.example).");
  process.exit(1);
}

const dynamo = new DynamoDBClient({ region: env.AWS_REGION, endpoint: env.DYNAMODB_ENDPOINT });
const TableName = env.PROCESSED_JOBS_TABLE;

// 2. The table. DynamoDB has no fixed columns: we only declare the KEY. "jobKey" is the partition
//    key (HASH): every item is found by it, and two items can't share one. PAY_PER_REQUEST: no
//    capacity to plan, pay per read/write (on AWS; locally it is free anyway).
try {
  await dynamo.send(
    new CreateTableCommand({
      TableName,
      AttributeDefinitions: [{ AttributeName: "jobKey", AttributeType: "S" }],
      KeySchema: [{ AttributeName: "jobKey", KeyType: "HASH" }],
      BillingMode: "PAY_PER_REQUEST",
    }),
  );
  console.log(`created table ${TableName}`);
} catch (err) {
  if (!(err instanceof ResourceInUseException)) throw err;
  console.log(`table ${TableName} already exists`);
}

// 3. TTL (time to live): DynamoDB deletes an item some time after the Unix time (in seconds) in
//    its "expiresAt" attribute (src/processed-jobs.ts sets it to 30 days ahead). Turning it on
//    twice is an error, so look first.
const ttl = await dynamo.send(new DescribeTimeToLiveCommand({ TableName }));
if (ttl.TimeToLiveDescription?.TimeToLiveStatus === "ENABLED") {
  console.log(`TTL already on (attribute ${ttl.TimeToLiveDescription.AttributeName})`);
} else {
  await dynamo.send(
    new UpdateTimeToLiveCommand({ TableName, TimeToLiveSpecification: { AttributeName: "expiresAt", Enabled: true } }),
  );
  console.log("TTL turned on (attribute expiresAt)");
}

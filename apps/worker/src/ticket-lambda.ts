import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { S3Client } from "@aws-sdk/client-s3";
import type { Context, SQSEvent } from "aws-lambda";
import { env } from "./config";
import { createLog } from "./log";
import { signingSecret, ticketPngWriter } from "./tickets/assets";
import { handleTicketBatch } from "./tickets/batch";
import { DynamoTickets } from "./tickets/store";

// 1. Same handler and SDK paths locally and on AWS. The shared worker image contains two
//    entry points; the ticket function selects this one through Lambda's imageConfig.command.
if (!env.TICKETS_TABLE || !env.TICKETS_BUCKET || !env.TICKET_SIGNING_SECRET_ID) throw new Error("ticket worker configuration is incomplete");
const common = { region: env.AWS_REGION, maxAttempts: 1,
  requestHandler: { connectionTimeout: 1000, requestTimeout: 3000, throwOnRequestTimeout: true } };
const deps = {
  tickets: new DynamoTickets(new DynamoDBClient({ ...common, endpoint: env.DYNAMODB_ENDPOINT }), env.TICKETS_TABLE),
  secret: signingSecret(new SecretsManagerClient({ ...common, endpoint: env.SECRETS_MANAGER_ENDPOINT }), env.TICKET_SIGNING_SECRET_ID),
  writePng: ticketPngWriter(new S3Client({ ...common, endpoint: env.S3_ENDPOINT, forcePathStyle: !!env.S3_ENDPOINT }), env.TICKETS_BUCKET),
};
const log = createLog({ consumer: "tickets" });

// 2. SDK errors become partial failures; SQS's visibility timeout supplies retry delay.
export async function handler(event: SQSEvent, context?: Pick<Context, "awsRequestId">) {
  return handleTicketBatch(event, deps, log.child({ awsRequestId: context?.awsRequestId }));
}

import { DynamoDBClient, QueryCommand, type AttributeValue } from "@aws-sdk/client-dynamodb";
import { TicketRecord } from "@minitickets/shared";
import { env } from "../config/env";

const dynamo = new DynamoDBClient({ region: env.AWS_REGION, endpoint: env.DYNAMODB_ENDPOINT,
  maxAttempts: 1, requestHandler: { connectionTimeout: 1000, requestTimeout: 3000, throwOnRequestTimeout: true } });

export async function listByUser(userId: string): Promise<TicketRecord[]> {
  // 1. Query ONLY the authenticated owner's partition, never a scan or a caller-supplied id.
  //    Strong reads reduce the pending window; a missing record can still be in the queue.
  if (!env.TICKETS_TABLE) return [];
  const tickets: TicketRecord[] = [];
  let cursor: Record<string, AttributeValue> | undefined;
  do {
    const page = await dynamo.send(new QueryCommand({ TableName: env.TICKETS_TABLE,
      KeyConditionExpression: "userId = :owner", ExpressionAttributeValues: { ":owner": { S: userId } },
      ConsistentRead: true, ExclusiveStartKey: cursor }));
    for (const item of page.Items ?? []) {
      tickets.push(TicketRecord.parse(Object.fromEntries(Object.entries(item).map(([key, value]) =>
        [key, value.N !== undefined ? Number(value.N) : value.S]))));
    }
    // 2. DynamoDB limits a page to 1 MB; follow its cursor so older tickets are not lost.
    cursor = page.LastEvaluatedKey;
  } while (cursor && Object.keys(cursor).length > 0);
  return tickets;
}

import { ConditionalCheckFailedException, DynamoDBClient, GetItemCommand, PutItemCommand, UpdateItemCommand, type AttributeValue } from "@aws-sdk/client-dynamodb";
import { TicketRecord } from "@minitickets/shared";

export interface TicketsStore {
  reserve(ticket: TicketRecord): Promise<TicketRecord>;
  markReady(ticket: TicketRecord): Promise<void>;
}

// 1. Keep SDK mapping at the data-store edge. Every stored field is text or an integer.
export function ticketItem(ticket: TicketRecord): Record<string, AttributeValue> {
  return Object.fromEntries(Object.entries(ticket).map(([key, value]) => [key,
    typeof value === "number" ? { N: String(value) } : { S: value },
  ]));
}

export class DynamoTickets implements TicketsStore {
  constructor(private client: DynamoDBClient, private table: string) {}

  async reserve(ticket: TicketRecord): Promise<TicketRecord> {
    // 2. One conditional reservation per (owner, booking seat). Concurrent deliveries may race;
    //    the loser strongly reads the winner's canonical token instead of making a second one.
    try {
      await this.client.send(new PutItemCommand({ TableName: this.table, Item: ticketItem(ticket),
        ConditionExpression: "attribute_not_exists(userId) AND attribute_not_exists(ticketId)" }));
      return ticket;
    } catch (err) {
      if (!(err instanceof ConditionalCheckFailedException)) throw err;
    }
    const result = await this.client.send(new GetItemCommand({ TableName: this.table,
      Key: { userId: { S: ticket.userId }, ticketId: { S: ticket.ticketId } }, ConsistentRead: true }));
    const existing = TicketRecord.parse(Object.fromEntries(Object.entries(result.Item ?? {}).map(([key, value]) =>
      [key, value.N !== undefined ? Number(value.N) : value.S])));
    // 3. A changed identity is corruption, not a harmless retry. Never replace its QR.
    for (const key of ["bookingId", "eventId", "userId", "seat", "eventStartsAt", "objectKey", "eventDate", "eventDateKey"] as const) {
      if (existing[key] !== ticket[key]) throw new Error("ticket reservation identity mismatch");
    }
    return existing;
  }

  async markReady(ticket: TicketRecord): Promise<void> {
    // 4. This happens only after S3 accepted the PNG; failure here is repaired by redelivery.
    await this.client.send(new UpdateItemCommand({ TableName: this.table,
      Key: { userId: { S: ticket.userId }, ticketId: { S: ticket.ticketId } },
      UpdateExpression: "SET #status = :ready", ConditionExpression: "qrToken = :token",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: { ":ready": { S: "ready" }, ":token": { S: ticket.qrToken } },
    }));
  }
}

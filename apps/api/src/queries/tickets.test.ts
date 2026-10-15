import { describe, expect, it, vi } from "vitest";

const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("../config/env", () => ({ env: { AWS_REGION: "us-east-1", TICKETS_TABLE: "tickets" } }));
vi.mock("@aws-sdk/client-dynamodb", async importOriginal => ({
  ...await importOriginal<typeof import("@aws-sdk/client-dynamodb")>(),
  DynamoDBClient: class { send = send; },
}));
const { listByUser } = await import("./tickets");

describe("owner-scoped ticket reads", () => {
  it("keeps the same owner constraint across DynamoDB's page boundary", async () => {
    const cursor = { userId: { S: "owner" }, ticketId: { S: "last-ticket" } };
    send.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: cursor }).mockResolvedValueOnce({ Items: [] });
    expect(await listByUser("owner")).toEqual([]);
    expect(send).toHaveBeenCalledTimes(2);
    for (const [command] of send.mock.calls) {
      expect(command.input).toMatchObject({ TableName: "tickets", KeyConditionExpression: "userId = :owner",
        ExpressionAttributeValues: { ":owner": { S: "owner" } }, ConsistentRead: true });
    }
    expect(send.mock.calls[1][0].input.ExclusiveStartKey).toEqual(cursor);
  });
});

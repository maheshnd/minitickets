import { ConditionalCheckFailedException, GetItemCommand, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { describe, expect, it, vi } from "vitest";
import { DynamoProcessedJobs } from "./processed-jobs";

// The DynamoDB store with a fake client: we check WHAT it asks DynamoDB, and how it reads the answers.
function storeWith(send: ReturnType<typeof vi.fn>) {
  return new DynamoProcessedJobs({ send } as never, "test-table");
}

describe("DynamoProcessedJobs", () => {
  it("isDone: a consistent read by jobKey; true when the item exists", async () => {
    const send = vi.fn().mockResolvedValueOnce({ Item: { jobKey: { S: "k" } } }).mockResolvedValueOnce({});
    const store = storeWith(send);

    expect(await store.isDone("k")).toBe(true);
    expect(await store.isDone("k")).toBe(false);
    const command = send.mock.calls[0][0];
    expect(command).toBeInstanceOf(GetItemCommand);
    expect(command.input).toEqual({ TableName: "test-table", Key: { jobKey: { S: "k" } }, ConsistentRead: true });
  });

  it("markDone: a CONDITIONAL put with an expiry about 30 days ahead", async () => {
    const send = vi.fn().mockResolvedValue({});
    const store = storeWith(send);

    expect(await store.markDone("k")).toBe("recorded");
    const command = send.mock.calls[0][0];
    expect(command).toBeInstanceOf(PutItemCommand);
    expect(command.input.ConditionExpression).toBe("attribute_not_exists(jobKey)");
    expect(command.input.Item.jobKey).toEqual({ S: "k" });
    const daysAhead = (Number(command.input.Item.expiresAt.N) - Date.now() / 1000) / 86400;
    expect(daysAhead).toBeCloseTo(30, 1);
  });

  it("markDone: condition failed (another worker recorded it first) -> 'already-recorded', no error", async () => {
    const send = vi.fn().mockRejectedValue(new ConditionalCheckFailedException({ message: "The conditional request failed", $metadata: {} }));
    expect(await storeWith(send).markDone("k")).toBe("already-recorded");
  });

  it("markDone: any other error is passed on (the message then fails and is retried)", async () => {
    const send = vi.fn().mockRejectedValue(new Error("connection refused"));
    await expect(storeWith(send).markDone("k")).rejects.toThrow("connection refused");
  });
});

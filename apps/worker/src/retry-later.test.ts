import { ChangeMessageVisibilityCommand } from "@aws-sdk/client-sqs";
import type { SQSEvent, SQSRecord } from "aws-lambda";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLog } from "./log";
import { delayFailedMessages } from "./retry-later";

// delayFailedMessages with a fake SQS client: which messages get which wait?
const QUEUE = "https://sqs.us-east-1.amazonaws.com/123456789012/minitickets-dev-jobs";

function record(id: string, receiveCount: string): SQSRecord {
  return { messageId: id, receiptHandle: `handle-${id}`, body: "{}", attributes: { ApproximateReceiveCount: receiveCount } } as SQSRecord;
}

// The JSON lines it wrote (log.ts), collected instead of printed.
let lines: Record<string, unknown>[] = [];
const log = createLog({}, (line) => {
  lines.push(JSON.parse(line));
});

describe("delayFailedMessages (backoff on Lambda and locally)", () => {
  beforeEach(() => {
    lines = [];
  });

  it("delays ONLY the failed messages, each by its own backoff (try 1 -> 10 s, try 2 -> 40 s)", async () => {
    const send = vi.fn().mockResolvedValue({});
    const event = { Records: [record("a", "1"), record("b", "1"), record("c", "2")] } as SQSEvent;

    await delayFailedMessages(event, { batchItemFailures: [{ itemIdentifier: "b" }, { itemIdentifier: "c" }] }, { send }, QUEUE, log);

    expect(send).toHaveBeenCalledTimes(2);
    for (const [command] of send.mock.calls) expect(command).toBeInstanceOf(ChangeMessageVisibilityCommand);
    expect(send.mock.calls.map(([command]) => command.input)).toEqual([
      { QueueUrl: QUEUE, ReceiptHandle: "handle-b", VisibilityTimeout: 10 },
      { QueueUrl: QUEUE, ReceiptHandle: "handle-c", VisibilityTimeout: 40 },
    ]);
  });

  it("no failures: no SQS call", async () => {
    const send = vi.fn();
    await delayFailedMessages({ Records: [record("a", "1")] } as SQSEvent, { batchItemFailures: [] }, { send }, QUEUE, log);
    expect(send).not.toHaveBeenCalled();
  });

  it("no queue URL: warns and changes nothing (the queue's own timeout applies)", async () => {
    const send = vi.fn();
    await delayFailedMessages({ Records: [record("a", "1")] } as SQSEvent, { batchItemFailures: [{ itemIdentifier: "a" }] }, { send }, undefined, log);
    expect(send).not.toHaveBeenCalled();
    expect(lines).toEqual([expect.objectContaining({ level: 40 })]);
  });

  it("one ChangeMessageVisibility fails: the others are still delayed, nothing throws", async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error("receipt handle expired")).mockResolvedValue({});
    const event = { Records: [record("a", "1"), record("b", "3")] } as SQSEvent;

    await delayFailedMessages(event, { batchItemFailures: [{ itemIdentifier: "a" }, { itemIdentifier: "b" }] }, { send }, QUEUE, log);

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0].input.VisibilityTimeout).toBe(120);
  });
});

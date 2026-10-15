import type { SQSEvent, SQSRecord } from "aws-lambda";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleBatch } from "./batch";
import type { Mailer } from "./mailer";
import type { ProcessedJobs } from "./processed-jobs";

// handleBatch with fakes: which messages does it report as failed?

function message(bookingNumber: number, overrides: Record<string, unknown> = {}) {
  const bookingId = `00000000-0000-4000-8000-00000000000${bookingNumber}`;
  return {
    type: "booking.confirmed",
    version: 1,
    messageId: `5f0c6a3e-2b7d-4c1e-9a8f-0d3b6e4c2a1${bookingNumber}`,
    bookingId,
    userEmail: `user${bookingNumber}@example.com`,
    eventTitle: "Indie Rock Showcase",
    eventVenue: "The Foundry",
    eventStartsAt: "2026-11-28T19:00:00.000Z",
    quantity: 1,
    occurredAt: "2026-10-14T10:00:00.000Z",
    ...overrides,
  };
}

// A queue record, the way Lambda (or local.ts) hands it over. The record's messageId is the
// queue's id for the message (sqs-1, sqs-2, ...).
function record(id: string, body: string): SQSRecord {
  return { messageId: id, receiptHandle: `handle-${id}`, body, attributes: { ApproximateReceiveCount: "1" } } as SQSRecord;
}

// An in-memory store that behaves like the real one: markDone remembers, isDone looks.
function memoryStore(): ProcessedJobs {
  const done = new Set<string>();
  return {
    isDone: async (key) => done.has(key),
    markDone: async (key) => (done.has(key) ? "already-recorded" : (done.add(key), "recorded")),
  };
}

describe("handleBatch (partial batch failures)", () => {
  // The batch logs one line per message; keep the test output quiet.
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("all succeed: an empty failure list", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const event = { Records: [1, 2, 3].map((n) => record(`sqs-${n}`, JSON.stringify(message(n)))) } as SQSEvent;

    const response = await handleBatch(event, { mailer: { send }, processedJobs: memoryStore() });

    expect(response).toEqual({ batchItemFailures: [] });
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("mailer fails for ONE message: only that one is reported, the others succeed", async () => {
    // The mailer fails only for user2's email.
    const mailer: Mailer = {
      send: vi.fn(async (email) => {
        if (email.to === "user2@example.com") throw new Error("mail server down");
      }),
    };
    const store = memoryStore();
    const event = { Records: [1, 2, 3].map((n) => record(`sqs-${n}`, JSON.stringify(message(n)))) } as SQSEvent;

    const response = await handleBatch(event, { mailer, processedJobs: store });

    expect(response).toEqual({ batchItemFailures: [{ itemIdentifier: "sqs-2" }] });
    expect(mailer.send).toHaveBeenCalledTimes(3);
    // 1 and 3 are recorded as done, 2 is not (so its retry will send it).
    expect(await store.isDone("booking.confirmed:00000000-0000-4000-8000-000000000001")).toBe(true);
    expect(await store.isDone("booking.confirmed:00000000-0000-4000-8000-000000000002")).toBe(false);
    expect(await store.isDone("booking.confirmed:00000000-0000-4000-8000-000000000003")).toBe(true);
  });

  it("invalid messages (bad schema, bad JSON) are failures too", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const event = {
      Records: [
        record("sqs-1", JSON.stringify(message(1))),
        record("sqs-2", JSON.stringify(message(2, { version: 9 }))),
        record("sqs-3", "not json {"),
        record("sqs-4", JSON.stringify(message(4))),
      ],
    } as SQSEvent;

    const response = await handleBatch(event, { mailer: { send }, processedJobs: memoryStore() });

    expect(response.batchItemFailures).toEqual([{ itemIdentifier: "sqs-2" }, { itemIdentifier: "sqs-3" }]);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("the same booking twice in one batch: one email, both succeed", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const body = JSON.stringify(message(1));
    const event = { Records: [record("sqs-1", body), record("sqs-2", body)] } as SQSEvent;

    const response = await handleBatch(event, { mailer: { send }, processedJobs: memoryStore() });

    expect(response.batchItemFailures).toEqual([]);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("never logs the email address", async () => {
    const send = vi.fn().mockRejectedValue(new Error("mail server down"));
    const event = {
      Records: [record("sqs-1", JSON.stringify(message(1))), record("sqs-2", JSON.stringify(message(2, { version: 9 })))],
    } as SQSEvent;

    await handleBatch(event, { mailer: { send }, processedJobs: memoryStore() });

    const logged = [...vi.mocked(console.log).mock.calls, ...vi.mocked(console.error).mock.calls].flat().join("\n");
    expect(logged).not.toContain("@example.com");
  });
});

import type { SQSEvent, SQSRecord } from "aws-lambda";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleBatch } from "./batch";
import { createLog } from "./log";
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

// The JSON lines the batch wrote (log.ts), collected instead of printed.
let lines: Record<string, unknown>[] = [];
const log = createLog({}, (line) => {
  lines.push(JSON.parse(line));
});

describe("handleBatch (partial batch failures)", () => {
  beforeEach(() => {
    lines = [];
  });

  it("all succeed: an empty failure list", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const event = { Records: [1, 2, 3].map((n) => record(`sqs-${n}`, JSON.stringify(message(n)))) } as SQSEvent;

    const response = await handleBatch(event, { mailer: { send }, processedJobs: memoryStore() }, log);

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

    const response = await handleBatch(event, { mailer, processedJobs: store }, log);

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

    const response = await handleBatch(event, { mailer: { send }, processedJobs: memoryStore() }, log);

    expect(response.batchItemFailures).toEqual([{ itemIdentifier: "sqs-2" }, { itemIdentifier: "sqs-3" }]);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("the same booking twice in one batch: one email, both succeed", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const body = JSON.stringify(message(1));
    const event = { Records: [record("sqs-1", body), record("sqs-2", body)] } as SQSEvent;

    const response = await handleBatch(event, { mailer: { send }, processedJobs: memoryStore() }, log);

    expect(response.batchItemFailures).toEqual([]);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("never logs the email address", async () => {
    const send = vi.fn().mockRejectedValue(new Error("mail server down"));
    const event = {
      Records: [record("sqs-1", JSON.stringify(message(1))), record("sqs-2", JSON.stringify(message(2, { version: 9 })))],
    } as SQSEvent;

    await handleBatch(event, { mailer: { send }, processedJobs: memoryStore() }, log);

    expect(lines.length).toBeGreaterThan(0);
    expect(JSON.stringify(lines)).not.toContain("@example.com");
  });
});

// P2: one booking can be followed from the api to the worker by its correlation id.
describe("handleBatch logs (P2: structured, with the correlation id)", () => {
  const CORRELATION_ID = "9b2f4c1d-7e3a-4f6b-8c5d-1a2b3c4d5e6f";

  beforeEach(() => {
    lines = [];
  });

  it("every line about a message carries ITS correlation id (also the mailer's line)", async () => {
    const event = {
      Records: [
        record("sqs-1", JSON.stringify(message(1, { correlationId: CORRELATION_ID }))),
        record("sqs-2", JSON.stringify(message(2))),
      ],
    } as SQSEvent;
    // The real LogMailer, so its own line is checked too.
    const { LogMailer } = await import("./mailer");

    await handleBatch(event, { mailer: new LogMailer(), processedJobs: memoryStore() }, log);

    const first = lines.filter((line) => line.sqsMessageId === "sqs-1");
    expect(first.map((line) => line.msg)).toEqual(["would send email (LogMailer)", "email sent"]);
    for (const line of first) expect(line.correlationId).toBe(CORRELATION_ID);
    // A message without one (sent before P2) still works; its lines just have no correlationId.
    const second = lines.filter((line) => line.sqsMessageId === "sqs-2");
    expect(second.length).toBe(2);
    for (const line of second) expect(line).not.toHaveProperty("correlationId");
  });

  it("a failure is an ERROR line (level 50) with the id, the try and the reason", async () => {
    const send = vi.fn().mockRejectedValue(new Error("mail server down"));
    const failing = { ...record("sqs-1", JSON.stringify(message(1, { correlationId: CORRELATION_ID }))) };
    failing.attributes.ApproximateReceiveCount = "2";

    await handleBatch({ Records: [failing] } as SQSEvent, { mailer: { send }, processedJobs: memoryStore() }, log);

    expect(lines).toEqual([
      expect.objectContaining({ level: 50, msg: "message failed", correlationId: CORRELATION_ID, tries: "2", error: "mail server down" }),
    ]);
  });

  it("an invalid message keeps its correlation id on the failure line (find the request that sent it)", async () => {
    const event = { Records: [record("sqs-1", JSON.stringify(message(1, { version: 9, correlationId: CORRELATION_ID })))] } as SQSEvent;

    await handleBatch(event, { mailer: { send: vi.fn() }, processedJobs: memoryStore() }, log);

    expect(lines[0]).toMatchObject({ level: 50, correlationId: CORRELATION_ID, error: "invalid message, wrong fields: version" });
  });
});

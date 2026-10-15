import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PendingMessage } from "../queries/outbox";

// 1. Fake only the SQL and SQS edges. The real service chooses validation, retries and loop timing.
const { deliverBatch, publish, state } = vi.hoisted(() => ({
  deliverBatch: vi.fn(), publish: vi.fn(), state: { enabled: true },
}));
vi.mock("../queries/outbox", () => ({ deliverBatch }));
vi.mock("../queues/jobs", () => ({ get jobsEnabled() { return state.enabled; }, publishBookingConfirmed: publish }));

const { relayOnce, retryInMs, startOutboxRelay } = await import("./outbox");
const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const row: PendingMessage = {
  id: "10000000-0000-4000-8000-000000000001",
  bookingId: "20000000-0000-4000-8000-000000000001",
  attempts: 0,
  payload: {
    type: "booking.confirmed", version: 1,
    messageId: "10000000-0000-4000-8000-000000000001", bookingId: "20000000-0000-4000-8000-000000000001",
    userEmail: "ada@example.com", eventTitle: "Concert", eventVenue: "Hall", quantity: 2,
    eventStartsAt: "2026-11-01T12:00:00.000Z", occurredAt: "2026-10-15T12:00:00.000Z",
    correlationId: "30000000-0000-4000-8000-000000000001",
  },
};

beforeEach(() => { vi.clearAllMocks(); state.enabled = true; publish.mockReset().mockResolvedValue(undefined); deliverBatch.mockReset(); });
afterEach(() => vi.useRealTimers());

describe("outbox delivery", () => {
  it("marks an accepted message only after publishing; preserves its identity and correlation", async () => {
    let accept!: () => void;
    publish.mockImplementationOnce(() => new Promise<void>((resolve) => { accept = resolve; }));
    deliverBatch.mockImplementation(async (deliver) => {
      const pending = deliver(row);
      expect(publish).toHaveBeenCalledWith(row.payload);
      let finished = false;
      void pending.then(() => { finished = true; });
      await Promise.resolve();
      expect(finished).toBe(false);
      accept();
      await expect(pending).resolves.toEqual({ sent: true });
      return 1;
    });
    await expect(relayOnce(log)).resolves.toBe(1);
    expect(log.info).toHaveBeenCalledWith({ messageId: row.id, bookingId: row.bookingId, correlationId: row.payload.correlationId }, expect.any(String));
    expect(JSON.stringify(log.info.mock.calls)).not.toContain(row.payload.userEmail);
  });

  it("retries failed sends with the SAME message id; never marks a failure as sent", async () => {
    publish.mockRejectedValueOnce(new Error(`queue unavailable: ${row.payload.userEmail}`));
    const results: unknown[] = [];
    deliverBatch.mockImplementation(async (deliver) => { results.push(await deliver(row)); return 1; });
    await relayOnce(log);
    await relayOnce(log);
    expect(results).toEqual([{ sent: false, retryInMs: 1000 }, { sent: true }]);
    expect(publish.mock.calls.map(([message]) => message.messageId)).toEqual([row.id, row.id]);
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain(row.payload.userEmail);
  });

  it.each([[0, 1000], [1, 2000], [5, 32000], [6, 60000], [10000, 60000]])("caps retry backoff after attempt %i", (attempts, delay) => {
    expect(retryInMs(attempts)).toBe(delay);
  });

  it.each(["bad schema", "wrong message id", "wrong booking id"])("keeps %s pending without exposing its payload", async (problem) => {
    const broken = structuredClone(row);
    if (problem === "bad schema") broken.payload.quantity = 0;
    if (problem === "wrong message id") broken.payload.messageId = row.bookingId;
    if (problem === "wrong booking id") broken.payload.bookingId = row.id;
    deliverBatch.mockImplementation(async (deliver) => {
      await expect(deliver(broken)).resolves.toEqual({ sent: false, retryInMs: 1000 }); return 1;
    });
    await relayOnce(log);
    expect(publish).not.toHaveBeenCalled();
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain(row.payload.userEmail);
  });

  it("leaves the outbox untouched while queue configuration is absent", async () => {
    state.enabled = false;
    await expect(relayOnce(log)).resolves.toBe(0);
    expect(deliverBatch).not.toHaveBeenCalled();
  });
});

describe("relay lifecycle", () => {
  it("waits for an in-flight batch on shutdown and starts no overlapping batch", async () => {
    vi.useFakeTimers();
    let finish!: (count: number) => void;
    deliverBatch.mockImplementation(() => new Promise<number>((resolve) => { finish = resolve; }));
    const stop = startOutboxRelay(log);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(deliverBatch).toHaveBeenCalledTimes(1);
    let stopped = false;
    const closing = stop().then(() => { stopped = true; });
    await Promise.resolve();
    expect(stopped).toBe(false);
    finish(10);
    await closing;
    expect(deliverBatch).toHaveBeenCalledTimes(1);
  });

  it("backs off database errors and recovers without an unhandled rejection", async () => {
    deliverBatch.mockRejectedValueOnce(new Error("database unavailable")).mockRejectedValueOnce(new Error("still down")).mockResolvedValue(0);
    const stop = startOutboxRelay(log);
    try {
      await vi.waitFor(() => expect(deliverBatch).toHaveBeenCalledTimes(3), { timeout: 4000, interval: 20 });
      expect(log.error.mock.calls.map(([fields]) => fields.retryInMs)).toEqual([1000, 2000]);
    } finally { await stop(); }
  });
});

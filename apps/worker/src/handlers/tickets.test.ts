import { describe, expect, it, vi } from "vitest";
import type { TicketRecord } from "@minitickets/shared";
import type { SQSEvent } from "aws-lambda";
import { handleTickets } from "./tickets";
import { handleTicketBatch } from "../tickets/batch";
import { createLog } from "../log";
import { signTicket } from "../tickets/token";

const message = { type: "booking.confirmed", version: 1, messageId: "10000000-0000-4000-8000-000000000001",
  bookingId: "20000000-0000-4000-8000-000000000002", userId: "30000000-0000-4000-8000-000000000003",
  eventId: "40000000-0000-4000-8000-000000000004", quantity: 3, userEmail: "private@example.com",
  eventTitle: "Show", eventVenue: "Hall", eventStartsAt: "2027-01-01T18:00:00.000Z", occurredAt: "2026-10-15T18:00:00.000Z" };

function setup() {
  // 1. Model the storage contract (atomic reservation + durable readiness), not AWS internals.
  const records = new Map<string, TicketRecord>();
  const deps = { secret: vi.fn(async () => "ab".repeat(32)), writePng: vi.fn<(key: string, token: string) => Promise<void>>(async () => {}), tickets: {
    reserve: vi.fn(async (ticket: TicketRecord) => {
      if (!records.has(ticket.ticketId)) records.set(ticket.ticketId, { ...ticket });
      return { ...records.get(ticket.ticketId)! };
    }),
    markReady: vi.fn(async (ticket: TicketRecord) => { records.get(ticket.ticketId)!.status = "ready"; }),
  } };
  return { records, deps };
}

describe("ticket issuance", () => {
  it("makes one ticket per seat and skips a replay with another transport message id", async () => {
    const { records, deps } = setup();
    expect(await handleTickets(message, deps)).toEqual({ created: 3, skipped: 0 });
    expect(await handleTickets({ ...message, messageId: message.userId }, deps)).toEqual({ created: 0, skipped: 3 });
    expect(records.size).toBe(3); expect(deps.writePng).toHaveBeenCalledTimes(3);
    expect([...records.values()].every(ticket => ticket.status === "ready" && ticket.eventDate === "2027-01-01")).toBe(true);
  });
  it("resumes a partial booking after S3 fails without marking the failed seat ready", async () => {
    const { records, deps } = setup();
    deps.writePng.mockResolvedValueOnce().mockRejectedValueOnce(new Error("S3 unavailable"));
    await expect(handleTickets(message, deps)).rejects.toThrow("S3 unavailable");
    expect([...records.values()].map(ticket => ticket.status)).toEqual(["ready", "creating"]);
    expect(await handleTickets(message, deps)).toEqual({ created: 2, skipped: 1 });
    expect(records.size).toBe(3); expect(deps.writePng).toHaveBeenCalledTimes(4);
  });
  it("recovers a crash after uploading but before completing the DynamoDB record", async () => {
    const { records, deps } = setup();
    deps.tickets.markReady.mockRejectedValueOnce(new Error("DynamoDB unavailable"));
    await expect(handleTickets(message, deps)).rejects.toThrow();
    const original = [...records.values()][0];
    // A different current key must still render the ORIGINAL saved token.
    deps.secret.mockResolvedValue("cd".repeat(32));
    await handleTickets(message, deps);
    expect(deps.writePng.mock.calls[1]).toEqual([original.objectKey, original.qrToken]);
  });
  it("concurrent copies converge on the same three identities and tokens", async () => {
    const { records, deps } = setup();
    await Promise.all([handleTickets(message, deps), handleTickets(message, deps)]);
    expect(records.size).toBe(3);
    const tokens = new Set(deps.writePng.mock.calls.map(call => call[1]));
    expect(tokens.size).toBe(3);
  });
  it.each([{ ...message, quantity: 5 }, { ...message, eventId: undefined }, { ...message, eventStartsAt: "invalid" }])("rejects invalid message before any side effect", async input => {
    const { deps } = setup();
    await expect(handleTickets(input, deps)).rejects.toThrow();
    expect(deps.secret).not.toHaveBeenCalled(); expect(deps.tickets.reserve).not.toHaveBeenCalled();
  });
  it("returns only failed message ids and never logs tokens or personal data", async () => {
    const { deps } = setup(); const lines: string[] = [];
    const event = { Records: [{ messageId: "bad", body: '{"email":"private@example.com"}' },
      { messageId: "good", body: JSON.stringify(message) }] } as SQSEvent;
    const result = await handleTicketBatch(event, deps, createLog({}, line => lines.push(line)));
    expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "bad" }] });
    expect(lines.join("")).not.toContain(message.userEmail);
    const ticket = (await deps.tickets.reserve.mock.results[0].value);
    expect(lines.join("")).not.toContain(signTicket(ticket, "ab".repeat(32)));
  });
});

import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { describe, expect, it, vi } from "vitest";
import { TicketRecord } from "@minitickets/shared";
import { DynamoTickets, ticketItem } from "./store";

const ticket = TicketRecord.parse({ version: 1, ticketId: "10000000-0000-4000-8000-000000000001:1",
  bookingId: "10000000-0000-4000-8000-000000000001", userId: "20000000-0000-4000-8000-000000000002",
  eventId: "30000000-0000-4000-8000-000000000003", seat: 1, eventStartsAt: "2027-01-01T18:00:00.000Z",
  eventDate: "2027-01-01", eventDateKey: "2027-01-01T18:00:00.000Z#ticket", createdAt: "2026-10-15T18:00:00.000Z",
  qrToken: "canonical-saved-token", status: "ready", objectKey: "tickets/10000000-0000-4000-8000-000000000001/1.png" });

describe("DynamoDB ticket reservation", () => {
  it("uses a strongly consistent read of the winner after losing a conditional insert", async () => {
    const send = vi.fn().mockRejectedValueOnce(new ConditionalCheckFailedException({ message: "exists", $metadata: {} }))
      .mockResolvedValueOnce({ Item: ticketItem(ticket) });
    expect(await new DynamoTickets({ send } as never, "tickets").reserve({ ...ticket, qrToken: "new-key-token" })).toEqual(ticket);
    expect(send.mock.calls[1][0].input).toMatchObject({ ConsistentRead: true });
  });
  it("does not overwrite a reservation with conflicting event identity", async () => {
    const send = vi.fn().mockRejectedValueOnce(new ConditionalCheckFailedException({ message: "exists", $metadata: {} }))
      .mockResolvedValueOnce({ Item: ticketItem(ticket) });
    await expect(new DynamoTickets({ send } as never, "tickets").reserve({ ...ticket, eventId: ticket.userId })).rejects.toThrow("identity mismatch");
  });
  it("propagates a store outage rather than treating it as a duplicate", async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error("unavailable"));
    await expect(new DynamoTickets({ send } as never, "tickets").reserve(ticket)).rejects.toThrow("unavailable");
    expect(send).toHaveBeenCalledTimes(1);
  });
});

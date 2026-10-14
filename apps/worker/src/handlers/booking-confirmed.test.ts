import { describe, expect, it, vi } from "vitest";
import { handleBookingConfirmed } from "./booking-confirmed";

// A fake mailer records what it was asked to send: no email system needed.
const valid = {
  type: "booking.confirmed",
  version: 1,
  messageId: "5f0c6a3e-2b7d-4c1e-9a8f-0d3b6e4c2a11",
  bookingId: "00000000-0000-4000-8000-0000000000b1",
  userEmail: "ada@example.com",
  eventTitle: "Indie Rock Showcase",
  eventVenue: "The Foundry",
  eventStartsAt: "2026-11-28T19:00:00.000Z",
  quantity: 2,
  occurredAt: "2026-10-14T10:00:00.000Z",
};

describe("handleBookingConfirmed", () => {
  it("valid message: sends ONE email with the right recipient, subject and body", async () => {
    const send = vi.fn().mockResolvedValue(undefined);

    await handleBookingConfirmed(valid, { mailer: { send } });

    expect(send).toHaveBeenCalledTimes(1);
    const email = send.mock.calls[0][0];
    expect(email.to).toBe("ada@example.com");
    expect(email.subject).toBe("Your booking is confirmed: Indie Rock Showcase");
    expect(email.body).toContain("2 tickets");
    expect(email.body).toContain("Indie Rock Showcase");
    expect(email.body).toContain("The Foundry");
    expect(email.body).toContain("Sat, 28 Nov 2026 19:00:00 GMT");
  });

  it("says '1 ticket' for a single ticket", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    await handleBookingConfirmed({ ...valid, quantity: 1 }, { mailer: { send } });
    expect(send.mock.calls[0][0].body).toContain("1 ticket for");
  });

  it.each([
    ["a wrong version", { ...valid, version: 2 }],
    ["a wrong type", { ...valid, type: "booking.cancelled" }],
    ["a missing field", { ...valid, eventTitle: undefined }],
    ["a bad email address", { ...valid, userEmail: "not-an-email" }],
    ["not an object", "hello"],
  ])("invalid message (%s): rejected, mailer not called", async (_name, message) => {
    const send = vi.fn();

    await expect(handleBookingConfirmed(message, { mailer: { send } })).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });

  it("a failing mailer makes the handler fail (so the message is not deleted and comes back)", async () => {
    const send = vi.fn().mockRejectedValue(new Error("mail server down"));
    await expect(handleBookingConfirmed(valid, { mailer: { send } })).rejects.toThrow("mail server down");
  });
});

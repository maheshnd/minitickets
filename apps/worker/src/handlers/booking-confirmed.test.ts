import { describe, expect, it, vi } from "vitest";
import { createLog } from "../log";
import type { ProcessedJobs } from "../processed-jobs";
import { handleBookingConfirmed } from "./booking-confirmed";

// Fakes instead of real systems: a fake mailer records what it was asked to send, and a fake
// processed-jobs store answers "done?" from a list we control. No email system, no DynamoDB.
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
const jobKey = "booking.confirmed:00000000-0000-4000-8000-0000000000b1";
// The handler only hands its logger to the mailer; a silent one is enough here.
const log = createLog({}, () => {});

// A store where nothing is done yet (or the given keys are), and recording succeeds.
function fakeStore(doneKeys: string[] = []) {
  return {
    isDone: vi.fn(async (key: string) => doneKeys.includes(key)),
    markDone: vi.fn<ProcessedJobs["markDone"]>().mockResolvedValue("recorded"),
  };
}

describe("handleBookingConfirmed", () => {
  it("valid message: sends ONE email with the right recipient, subject and body", async () => {
    const send = vi.fn().mockResolvedValue(undefined);

    await handleBookingConfirmed(valid, { mailer: { send }, processedJobs: fakeStore() }, log);

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
    await handleBookingConfirmed({ ...valid, quantity: 1 }, { mailer: { send }, processedJobs: fakeStore() }, log);
    expect(send.mock.calls[0][0].body).toContain("1 ticket for");
  });

  it.each([
    ["a wrong version", { ...valid, version: 2 }],
    ["a wrong type", { ...valid, type: "booking.cancelled" }],
    ["a missing field", { ...valid, eventTitle: undefined }],
    ["a bad email address", { ...valid, userEmail: "not-an-email" }],
    ["not an object", "hello"],
  ])("invalid message (%s): rejected, mailer not called, nothing recorded", async (_name, message) => {
    const send = vi.fn();
    const store = fakeStore();

    await expect(handleBookingConfirmed(message, { mailer: { send }, processedJobs: store }, log)).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
    expect(store.markDone).not.toHaveBeenCalled();
  });

  it("not processed yet: sends the email once, THEN records the BUSINESS key", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const store = fakeStore();

    const result = await handleBookingConfirmed(valid, { mailer: { send }, processedJobs: store }, log);

    expect(result).toEqual({ status: "sent", jobKey });
    expect(send).toHaveBeenCalledTimes(1);
    // Keyed by the booking, not by the messageId.
    expect(store.isDone).toHaveBeenCalledWith(jobKey);
    expect(store.markDone).toHaveBeenCalledExactlyOnceWith(jobKey);
    // Order matters: send first, record second (recording first could lose the email).
    expect(send.mock.invocationCallOrder[0]).toBeLessThan(store.markDone.mock.invocationCallOrder[0]);
  });

  it("already processed: no email, nothing recorded again, success (skipped)", async () => {
    const send = vi.fn();
    const store = fakeStore([jobKey]);

    const result = await handleBookingConfirmed(valid, { mailer: { send }, processedJobs: store }, log);

    expect(result).toEqual({ status: "skipped-duplicate", jobKey });
    expect(send).not.toHaveBeenCalled();
    expect(store.markDone).not.toHaveBeenCalled();
  });

  it("the same booking in a NEW envelope (another messageId) is still a duplicate", async () => {
    const send = vi.fn();
    const store = fakeStore([jobKey]);

    const result = await handleBookingConfirmed(
      { ...valid, messageId: "11111111-2222-4333-8444-555555555555" },
      { mailer: { send }, processedJobs: store },
      log,
    );

    expect(result.status).toBe("skipped-duplicate");
    expect(send).not.toHaveBeenCalled();
  });

  it("conditional put conflict (another worker recorded it first): success, no error", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const store = fakeStore();
    store.markDone.mockResolvedValue("already-recorded");

    const result = await handleBookingConfirmed(valid, { mailer: { send }, processedJobs: store }, log);

    expect(result.status).toBe("sent");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("a failing mailer makes the handler fail, and nothing is recorded (so the message comes back)", async () => {
    const send = vi.fn().mockRejectedValue(new Error("mail server down"));
    const store = fakeStore();

    await expect(handleBookingConfirmed(valid, { mailer: { send }, processedJobs: store }, log)).rejects.toThrow("mail server down");
    expect(store.markDone).not.toHaveBeenCalled();
  });
});

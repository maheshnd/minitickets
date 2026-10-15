import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictError, NotFoundError } from "../errors";

// 1. Both edges are fakes, so this needs no Postgres and no Redis:
//    - the query layer (createBookingTx = the real transaction in real life);
//    - the events service's cache invalidation.
//    Both write into ONE list of calls, so a test can check the ORDER they ran in.
//    The real transaction and lock are checked by `pnpm demo:booking-race` and the e2e test.
const calls: string[] = [];
const createBookingTx = vi.fn();
const listByUser = vi.fn();
vi.mock("../queries/bookings", () => ({
  createBookingTx: (eventId: string, userId: string, quantity: number, idempotencyKey: string) => {
    calls.push("createBookingTx");
    return createBookingTx(eventId, userId, quantity, idempotencyKey);
  },
  listByUser: (userId: string) => listByUser(userId),
}));

// 1b. Step S1a: the user lookup and the jobs queue are fakes too, in the same call list.
const findUserById = vi.fn();
vi.mock("../queries/users", () => ({ findById: (id: string) => findUserById(id) }));

const publishBookingConfirmed = vi.fn();
let jobsEnabled = true;
vi.mock("../queues/jobs", () => ({
  get jobsEnabled() {
    return jobsEnabled;
  },
  publishBookingConfirmed: (message: unknown) => {
    calls.push("publishBookingConfirmed");
    return publishBookingConfirmed(message);
  },
}));

const invalidateEventLists = vi.fn();
vi.mock("./events", () => ({
  invalidateEventLists: (log: unknown) => {
    calls.push("invalidateEventLists");
    return invalidateEventLists(log);
  },
}));

const { bookTicket, myTickets } = await import("./bookings");

const log = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
const EVENT_ID = "00000000-0000-4000-8000-000000000004";
const OTHER_EVENT_ID = "00000000-0000-4000-8000-000000000005";
const KEY = "5f0c6a3e-2b7d-4c1e-9a8f-0d3b6e4c2a11";
// The api request's correlation id (P2): the message must carry it to the worker.
const CORRELATION_ID = "9b2f4c1d-7e3a-4f6b-8c5d-1a2b3c4d5e6f";
const savedRow = {
  id: "00000000-0000-4000-8000-0000000000b1",
  eventId: EVENT_ID,
  userId: "u1",
  quantity: 2,
  status: "confirmed" as const,
  createdAt: new Date("2026-10-14T10:00:00Z"),
  idempotencyKey: KEY,
};
// The event details the transaction hands back with a NEW booking (queries/bookings.ts).
const savedEvent = { title: "Indie Rock Showcase", venue: "The Foundry", startsAt: new Date("2026-11-28T19:00:00Z") };
// What bookTicket answered for savedRow the first time: a replay must answer exactly this.
const firstAnswer = {
  id: savedRow.id,
  eventId: EVENT_ID,
  quantity: 2,
  status: "confirmed",
  createdAt: "2026-10-14T10:00:00.000Z",
};

beforeEach(() => {
  calls.length = 0;
  createBookingTx.mockReset().mockResolvedValue({ kind: "created", booking: savedRow, event: savedEvent });
  findUserById.mockReset().mockResolvedValue({ id: "u1", email: "ada@example.com" });
  publishBookingConfirmed.mockReset().mockResolvedValue(undefined);
  jobsEnabled = true;
  log.error.mockReset();
  log.info.mockReset();
  listByUser.mockReset();
  invalidateEventLists.mockReset().mockResolvedValue(undefined);
});

describe("bookTicket", () => {
  it("runs the transaction FIRST, then invalidates the events cache, and returns the public booking", async () => {
    const booking = await bookTicket("u1", { eventId: EVENT_ID, quantity: 2, idempotencyKey: KEY }, log, CORRELATION_ID);

    // 2. The user comes from the caller (the session), the rest (key included) from the input.
    expect(createBookingTx).toHaveBeenCalledWith(EVENT_ID, "u1", 2, KEY);
    // 3. Write first, then invalidate: the other order could refill the cache with the old seats.
    expect(calls).toEqual(["createBookingTx", "invalidateEventLists", "publishBookingConfirmed"]);
    expect(invalidateEventLists).toHaveBeenCalledWith(log);
    // 4. No userId and no key in the answer; the date is ISO text.
    expect(booking).toEqual(firstAnswer);
  });

  it.each([
    ["ConflictError (not enough seats)", new ConflictError("Not enough seats left")],
    ["NotFoundError (unknown event)", new NotFoundError("Event not found")],
  ])("lets a %s pass through untouched, and invalidates nothing (nothing changed)", async (_name, error) => {
    createBookingTx.mockRejectedValue(error);

    await expect(bookTicket("u1", { eventId: EVENT_ID, quantity: 1, idempotencyKey: KEY }, log, CORRELATION_ID)).rejects.toBe(error);
    expect(calls).toEqual(["createBookingTx"]);
  });
});

// 5. Step F2b: the transaction found a booking with this user + key ("existing") and wrote nothing.
//    That it really wrote nothing (seats untouched, one row) is Postgres' job and is checked against
//    a real database by `pnpm demo:idempotency` and e2e/booking-idempotency.spec.ts. Here we check
//    what the service DOES with it.
describe("bookTicket with a repeated idempotency key", () => {
  it("same event + same quantity: returns the EXISTING booking, the same answer as the first time, and changes nothing", async () => {
    const first = await bookTicket("u1", { eventId: EVENT_ID, quantity: 2, idempotencyKey: KEY }, log, CORRELATION_ID);
    calls.length = 0;
    createBookingTx.mockResolvedValue({ kind: "existing", booking: savedRow });

    const replay = await bookTicket("u1", { eventId: EVENT_ID, quantity: 2, idempotencyKey: KEY }, log, CORRELATION_ID);

    expect(replay).toEqual(first);
    expect(replay.id).toBe(savedRow.id);
    // No seats changed, so no cache is invalidated (an invalidation would be the sign of a write).
    expect(calls).toEqual(["createBookingTx"]);
  });

  it.each([
    ["a different quantity", { eventId: EVENT_ID, quantity: 3 }],
    ["a different event", { eventId: OTHER_EVENT_ID, quantity: 2 }],
  ])("%s: ConflictError (409), and nothing invalidated", async (_name, request) => {
    createBookingTx.mockResolvedValue({ kind: "existing", booking: savedRow });

    const result = bookTicket("u1", { ...request, idempotencyKey: KEY }, log, CORRELATION_ID);

    await expect(result).rejects.toBeInstanceOf(ConflictError);
    await expect(result).rejects.toThrow("This idempotency key was already used for a different booking");
    expect(calls).toEqual(["createBookingTx"]);
  });
});

// 6. Step S1a: the confirmation message.
describe("bookTicket and the confirmation message", () => {
  it("a NEW booking: publishes ONE message, AFTER the transaction, with everything the email needs", async () => {
    await bookTicket("u1", { eventId: EVENT_ID, quantity: 2, idempotencyKey: KEY }, log, CORRELATION_ID);

    // After the commit (createBookingTx is first in the list), never before.
    expect(calls[0]).toBe("createBookingTx");
    expect(calls).toContain("publishBookingConfirmed");
    expect(publishBookingConfirmed).toHaveBeenCalledTimes(1);
    expect(publishBookingConfirmed.mock.calls[0][0]).toMatchObject({
      type: "booking.confirmed",
      version: 1,
      bookingId: savedRow.id,
      userEmail: "ada@example.com",
      eventTitle: "Indie Rock Showcase",
      eventVenue: "The Foundry",
      eventStartsAt: "2026-11-28T19:00:00.000Z",
      quantity: 2,
      correlationId: CORRELATION_ID,
    });
    // The log line names the ids, never the address.
    expect(log.info).toHaveBeenCalledWith(expect.stringContaining("messageId="));
    expect(JSON.stringify(log.info.mock.calls)).not.toContain("ada@example.com");
  });

  it("a replay (same key again): NO message", async () => {
    createBookingTx.mockResolvedValue({ kind: "existing", booking: savedRow });

    await bookTicket("u1", { eventId: EVENT_ID, quantity: 2, idempotencyKey: KEY }, log, CORRELATION_ID);

    expect(publishBookingConfirmed).not.toHaveBeenCalled();
  });

  it("a failed booking (409): NO message", async () => {
    createBookingTx.mockRejectedValue(new ConflictError("Not enough seats left"));
    await expect(bookTicket("u1", { eventId: EVENT_ID, quantity: 1, idempotencyKey: KEY }, log, CORRELATION_ID)).rejects.toThrow();
    expect(publishBookingConfirmed).not.toHaveBeenCalled();
  });

  it("the queue is down: the booking still succeeds, the error is logged WITHOUT the email address", async () => {
    publishBookingConfirmed.mockRejectedValue(new Error("queue unreachable"));

    await expect(bookTicket("u1", { eventId: EVENT_ID, quantity: 2, idempotencyKey: KEY }, log, CORRELATION_ID)).resolves.toEqual(firstAnswer);

    expect(log.error).toHaveBeenCalledTimes(1);
    expect(log.error.mock.calls[0][0]).toMatchObject({ bookingId: savedRow.id });
    expect(JSON.stringify(log.error.mock.calls)).not.toContain("ada@example.com");
  });

  it("the user lookup fails: the booking still succeeds and nothing is published", async () => {
    findUserById.mockRejectedValue(new Error("db hiccup"));

    await expect(bookTicket("u1", { eventId: EVENT_ID, quantity: 2, idempotencyKey: KEY }, log, CORRELATION_ID)).resolves.toEqual(firstAnswer);
    expect(publishBookingConfirmed).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalledTimes(1);
  });

  it("publishing is off (no JOBS_QUEUE_URL): no lookup, no message, booking works", async () => {
    jobsEnabled = false;

    await expect(bookTicket("u1", { eventId: EVENT_ID, quantity: 2, idempotencyKey: KEY }, log, CORRELATION_ID)).resolves.toEqual(firstAnswer);
    expect(findUserById).not.toHaveBeenCalled();
    expect(publishBookingConfirmed).not.toHaveBeenCalled();
  });
});

describe("myTickets", () => {
  it("returns the joined rows with ISO dates, in the order the query gave them", async () => {
    listByUser.mockResolvedValue([
      {
        ...savedRow,
        event: { title: "Indie Rock Showcase", venue: "The Foundry", startsAt: new Date("2026-11-28T19:00:00Z") },
      },
    ]);

    await expect(myTickets("u1")).resolves.toEqual([
      {
        id: savedRow.id,
        eventId: EVENT_ID,
        quantity: 2,
        status: "confirmed",
        createdAt: "2026-10-14T10:00:00.000Z",
        event: { title: "Indie Rock Showcase", venue: "The Foundry", startsAt: "2026-11-28T19:00:00.000Z" },
      },
    ]);
    expect(listByUser).toHaveBeenCalledWith("u1");
  });
});

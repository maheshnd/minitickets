import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictError, NotFoundError } from "../errors";

// 1. Both edges are fakes, so this needs no Postgres and no Redis:
//    - the query layer (createBookingTx = the real transaction in real life);
//    - the events service's cache invalidation.
//    Both write into ONE list of calls, so a test can check the ORDER they ran in.
//    The real transaction and lock are checked by `pnpm demo:booking-race` and the e2e test.
const calls: string[] = [];
vi.mock("../config/env", () => ({ env: { INVENTORY_GATE_ENABLED: false } }));
vi.mock("../queries/inventory", () => ({ reserve: vi.fn(), initialize: vi.fn(), settle: vi.fn() }));
const createBookingTx = vi.fn();
const listByUser = vi.fn();
vi.mock("../queries/bookings", () => ({
  createBookingTx: (eventId: string, userId: string, quantity: number, idempotencyKey: string, correlationId: string) => {
    calls.push("createBookingTx");
    return createBookingTx(eventId, userId, quantity, idempotencyKey, correlationId);
  },
  listByUser: (userId: string) => listByUser(userId),
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
  createBookingTx.mockReset().mockResolvedValue({ kind: "created", booking: savedRow });
  log.error.mockReset();
  log.info.mockReset();
  listByUser.mockReset();
  invalidateEventLists.mockReset().mockResolvedValue(undefined);
});

describe("bookTicket", () => {
  it("runs the transaction FIRST, then invalidates the events cache, and returns the public booking", async () => {
    const booking = await bookTicket("u1", { eventId: EVENT_ID, quantity: 2, idempotencyKey: KEY }, log, CORRELATION_ID);

    // 2. The user comes from the caller (the session), the rest (key included) from the input.
    expect(createBookingTx).toHaveBeenCalledWith(EVENT_ID, "u1", 2, KEY, CORRELATION_ID);
    // 3. Write first, then invalidate: the other order could refill the cache with the old seats.
    expect(calls).toEqual(["createBookingTx", "invalidateEventLists"]);
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

// 6. P3: confirmation persistence belongs to the transaction, never to a direct publish here.
it("an outbox write failure fails the booking instead of accepting one without a message", async () => {
  const error = new Error("outbox insert failed");
  createBookingTx.mockRejectedValue(error);
  await expect(bookTicket("u1", { eventId: EVENT_ID, quantity: 2, idempotencyKey: KEY }, log, CORRELATION_ID)).rejects.toBe(error);
  expect(calls).toEqual(["createBookingTx"]);
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

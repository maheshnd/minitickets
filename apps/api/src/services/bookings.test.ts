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
  createBookingTx: (eventId: string, userId: string, quantity: number) => {
    calls.push("createBookingTx");
    return createBookingTx(eventId, userId, quantity);
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

const log = { error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
const EVENT_ID = "00000000-0000-4000-8000-000000000004";
const savedRow = {
  id: "00000000-0000-4000-8000-0000000000b1",
  eventId: EVENT_ID,
  userId: "u1",
  quantity: 2,
  status: "confirmed" as const,
  createdAt: new Date("2026-10-14T10:00:00Z"),
};

beforeEach(() => {
  calls.length = 0;
  createBookingTx.mockReset().mockResolvedValue(savedRow);
  listByUser.mockReset();
  invalidateEventLists.mockReset().mockResolvedValue(undefined);
});

describe("bookTicket", () => {
  it("runs the transaction FIRST, then invalidates the events cache, and returns the public booking", async () => {
    const booking = await bookTicket("u1", { eventId: EVENT_ID, quantity: 2 }, log);

    // 2. The user comes from the caller (the session), the rest from the input.
    expect(createBookingTx).toHaveBeenCalledWith(EVENT_ID, "u1", 2);
    // 3. Write first, then invalidate: the other order could refill the cache with the old seats.
    expect(calls).toEqual(["createBookingTx", "invalidateEventLists"]);
    expect(invalidateEventLists).toHaveBeenCalledWith(log);
    // 4. No userId in the answer; the date is ISO text.
    expect(booking).toEqual({
      id: savedRow.id,
      eventId: EVENT_ID,
      quantity: 2,
      status: "confirmed",
      createdAt: "2026-10-14T10:00:00.000Z",
    });
  });

  it.each([
    ["ConflictError (not enough seats)", new ConflictError("Not enough seats left")],
    ["NotFoundError (unknown event)", new NotFoundError("Event not found")],
  ])("lets a %s pass through untouched, and invalidates nothing (nothing changed)", async (_name, error) => {
    createBookingTx.mockRejectedValue(error);

    await expect(bookTicket("u1", { eventId: EVENT_ID, quantity: 1 }, log)).rejects.toBe(error);
    expect(calls).toEqual(["createBookingTx"]);
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

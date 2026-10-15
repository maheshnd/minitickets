import { getHTTPStatusCodeFromError } from "@trpc/server/http";
import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BadRequestError, ConflictError, NotFoundError } from "../errors";
import type { Context } from "../trpc/context";

// The REAL bookings router, the REAL tRPC middlewares (login check, errorMapper) and the REAL
// bookings service run here. Only the edges are fakes: the query layer (the transaction) and the
// events cache invalidation. So this checks what the browser really gets: the HTTP status and the
// message of each business error.
const createBookingTx = vi.fn();
vi.mock("../queries/bookings", () => ({
  createBookingTx: (eventId: string, userId: string, quantity: number, idempotencyKey: string, correlationId: string) =>
    createBookingTx(eventId, userId, quantity, idempotencyKey, correlationId),
  listByUser: vi.fn(),
}));

const invalidateEventLists = vi.fn();
vi.mock("../services/events", () => ({ invalidateEventLists: () => invalidateEventLists() }));

// trpc/init.ts imports the users service (for adminProcedure's role lookup), which would open a real
// database pool. Booking never asks for a role, so a stub is enough.
vi.mock("../services/users", () => ({ getRole: vi.fn() }));

const { createCallerFactory } = await import("../trpc/init");
const { bookingsRouter } = await import("./bookings");

const EVENT_ID = "00000000-0000-4000-8000-000000000004";
const KEY = "5f0c6a3e-2b7d-4c1e-9a8f-0d3b6e4c2a11";

// 1. A context as createContext would build it: logged in as u1 (or logged out with null).
function callerFor(session: { userId: string } | null) {
  const log = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
  // req.id = the request's correlation id (app.ts 1b2), which the procedure hands to the service.
  const req = { log, id: "9b2f4c1d-7e3a-4f6b-8c5d-1a2b3c4d5e6f" };
  const ctx = { req, res: {}, sessionId: session ? "sid-1" : undefined, session } as unknown as Context;
  return createCallerFactory(bookingsRouter)(ctx);
}

// 2. Run a call that should fail; return the HTTP status and message the client would see.
async function failure(call: Promise<unknown>) {
  const error = await call.then(
    () => {
      throw new Error("expected the call to fail");
    },
    (err: unknown) => err,
  );
  if (!(error instanceof TRPCError)) throw error;
  return { status: getHTTPStatusCodeFromError(error), message: error.message };
}

// A stored booking: 2 tickets of EVENT_ID, made by u1 with KEY.
const savedRow = {
  id: "00000000-0000-4000-8000-0000000000b1",
  eventId: EVENT_ID,
  userId: "u1",
  quantity: 2,
  status: "confirmed",
  createdAt: new Date("2026-10-14T10:00:00Z"),
  idempotencyKey: KEY,
};

beforeEach(() => {
  createBookingTx.mockReset();
  invalidateEventLists.mockReset().mockResolvedValue(undefined);
});

describe("bookings.create: business errors keep their message and get the right HTTP status", () => {
  it.each([
    [new ConflictError("Not enough seats left"), 409],
    [new NotFoundError("Event not found"), 404],
    [new BadRequestError("This event has already started"), 400],
  ])("%s -> %i", async (error, status) => {
    createBookingTx.mockRejectedValue(error);

    const result = await failure(callerFor({ userId: "u1" }).create({ eventId: EVENT_ID, quantity: 1, idempotencyKey: KEY }));

    expect(result).toEqual({ status, message: error.message });
    expect(invalidateEventLists).not.toHaveBeenCalled();
  });
});

describe("bookings.create: checks before the service runs", () => {
  it("logged out -> 401, and no transaction", async () => {
    const result = await failure(callerFor(null).create({ eventId: EVENT_ID, quantity: 1, idempotencyKey: KEY }));

    expect(result.status).toBe(401);
    expect(createBookingTx).not.toHaveBeenCalled();
  });

  it.each([0, 5, 1.5])("quantity %s -> 400 (only 1-4 whole tickets), and no transaction", async (quantity) => {
    const result = await failure(callerFor({ userId: "u1" }).create({ eventId: EVENT_ID, quantity, idempotencyKey: KEY }));

    expect(result).toEqual({ status: 400, message: expect.any(String) });
    expect(createBookingTx).not.toHaveBeenCalled();
  });

  it("books for the SESSION's user", async () => {
    createBookingTx.mockResolvedValue({ kind: "created", booking: { ...savedRow, quantity: 3 } });

    await expect(callerFor({ userId: "u1" }).create({ eventId: EVENT_ID, quantity: 3, idempotencyKey: KEY })).resolves.toMatchObject({
      quantity: 3,
    });
    expect(createBookingTx).toHaveBeenCalledWith(EVENT_ID, "u1", 3, KEY, "9b2f4c1d-7e3a-4f6b-8c5d-1a2b3c4d5e6f");
  });

  it("no idempotency key, or one that is not a UUID -> 400, and no transaction (step F2b)", async () => {
    const caller = callerFor({ userId: "u1" });
    const noKey = { eventId: EVENT_ID, quantity: 1 } as Parameters<typeof caller.create>[0];

    await expect(failure(caller.create(noKey))).resolves.toMatchObject({ status: 400 });
    await expect(failure(caller.create({ eventId: EVENT_ID, quantity: 1, idempotencyKey: "retry-1" }))).resolves.toMatchObject({
      status: 400,
    });
    expect(createBookingTx).not.toHaveBeenCalled();
  });
});

describe("bookings.create: a repeated idempotency key (step F2b)", () => {
  it("same request again -> 200 with the SAME booking id; different request -> 409 with the message", async () => {
    const caller = callerFor({ userId: "u1" });
    createBookingTx.mockResolvedValue({ kind: "existing", booking: savedRow });

    await expect(caller.create({ eventId: EVENT_ID, quantity: 2, idempotencyKey: KEY })).resolves.toMatchObject({ id: savedRow.id });
    await expect(failure(caller.create({ eventId: EVENT_ID, quantity: 1, idempotencyKey: KEY }))).resolves.toEqual({
      status: 409,
      message: "This idempotency key was already used for a different booking",
    });
    expect(invalidateEventLists).not.toHaveBeenCalled();
  });
});

describe("bookings.mine", () => {
  it("logged out -> 401", async () => {
    await expect(failure(callerFor(null).mine())).resolves.toMatchObject({ status: 401 });
  });
});

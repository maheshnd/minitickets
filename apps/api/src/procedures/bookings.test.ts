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
  createBookingTx: (eventId: string, userId: string, quantity: number) => createBookingTx(eventId, userId, quantity),
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

// 1. A context as createContext would build it: logged in as u1 (or logged out with null).
function callerFor(session: { userId: string } | null) {
  const log = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
  const ctx = { req: { log }, res: {}, sessionId: session ? "sid-1" : undefined, session } as unknown as Context;
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

    const result = await failure(callerFor({ userId: "u1" }).create({ eventId: EVENT_ID, quantity: 1 }));

    expect(result).toEqual({ status, message: error.message });
    expect(invalidateEventLists).not.toHaveBeenCalled();
  });
});

describe("bookings.create: checks before the service runs", () => {
  it("logged out -> 401, and no transaction", async () => {
    const result = await failure(callerFor(null).create({ eventId: EVENT_ID, quantity: 1 }));

    expect(result.status).toBe(401);
    expect(createBookingTx).not.toHaveBeenCalled();
  });

  it.each([0, 5, 1.5])("quantity %s -> 400 (only 1-4 whole tickets), and no transaction", async (quantity) => {
    const result = await failure(callerFor({ userId: "u1" }).create({ eventId: EVENT_ID, quantity }));

    expect(result).toEqual({ status: 400, message: expect.any(String) });
    expect(createBookingTx).not.toHaveBeenCalled();
  });

  it("books for the SESSION's user", async () => {
    createBookingTx.mockResolvedValue({
      id: "00000000-0000-4000-8000-0000000000b1",
      eventId: EVENT_ID,
      userId: "u1",
      quantity: 3,
      status: "confirmed",
      createdAt: new Date("2026-10-14T10:00:00Z"),
    });

    await expect(callerFor({ userId: "u1" }).create({ eventId: EVENT_ID, quantity: 3 })).resolves.toMatchObject({ quantity: 3 });
    expect(createBookingTx).toHaveBeenCalledWith(EVENT_ID, "u1", 3);
  });
});

describe("bookings.mine", () => {
  it("logged out -> 401", async () => {
    await expect(failure(callerFor(null).mine())).resolves.toMatchObject({ status: 401 });
  });
});

import { beforeEach, expect, it, vi } from "vitest";
import { ConflictError } from "../errors";
const f = vi.hoisted(() => ({ reserve: vi.fn(), initialize: vi.fn(), settle: vi.fn(), event: vi.fn(),
  create: vi.fn(), replay: vi.fn(), env: { INVENTORY_GATE_ENABLED: true } }));
vi.mock("../config/env", () => ({ env: f.env }));
vi.mock("../queries/inventory", () => ({ reserve: f.reserve, initialize: f.initialize, settle: f.settle }));
vi.mock("../queries/events", () => ({ findById: f.event }));
vi.mock("../queries/bookings", () => ({ createBookingTx: f.create, findByIdempotencyKey: f.replay }));
const { createGatedBooking } = await import("./booking-inventory");
const input = { eventId: "event", quantity: 2, idempotencyKey: "key" };
const log = { warn: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn() };
const row = { id: "booking" };
beforeEach(() => {
  vi.clearAllMocks(); f.env.INVENTORY_GATE_ENABLED = true;
  f.reserve.mockReset().mockResolvedValue(1); f.create.mockReset().mockResolvedValue({ kind: "created", booking: row });
  f.settle.mockReset().mockResolvedValue(undefined); f.replay.mockReset().mockResolvedValue(undefined);
  f.event.mockReset().mockResolvedValue({ seatsLeft: 10, startsAt: new Date("2099-01-01") });
});
it("initializes once on a miss and consumes only a newly created booking", async () => {
  f.reserve.mockResolvedValueOnce(-1).mockResolvedValueOnce(1);
  await createGatedBooking("user", input, log, "correlation");
  expect(f.initialize).toHaveBeenCalledWith("event", 10);
  expect(f.settle.mock.calls[0][3]).toBe(false);
  expect(f.create).toHaveBeenCalledWith("event", "user", 2, "key", "correlation");
});
it("refunds on transaction failure and preserves that error even if refund fails", async () => {
  const failure = new Error("DB rollback"); f.create.mockRejectedValue(failure); f.settle.mockRejectedValue(new Error("Redis timeout"));
  await expect(createGatedBooking("user", input, log, "c")).rejects.toBe(failure);
  expect(f.settle.mock.calls[0][3]).toBe(true);
  expect(log.warn).toHaveBeenCalled();
});
it("refunds a duplicate DB result and never refunds another attempt's in-flight debit", async () => {
  f.create.mockResolvedValue({ kind: "existing", booking: row });
  await createGatedBooking("user", input, log, "c");
  expect(f.settle.mock.calls[0][3]).toBe(true);
  f.settle.mockClear(); f.reserve.mockResolvedValue(2);
  await createGatedBooking("user", input, log, "c");
  expect(f.settle).not.toHaveBeenCalled();
});
it("sold out skips the locking transaction but returns existing idempotent bookings", async () => {
  f.reserve.mockResolvedValue(0);
  await expect(createGatedBooking("user", input, log, "c")).rejects.toBeInstanceOf(ConflictError);
  expect(f.create).not.toHaveBeenCalled();
  f.replay.mockResolvedValue(row);
  await expect(createGatedBooking("user", input, log, "c")).resolves.toEqual({ kind: "existing", booking: row });
});
it("falls back to the same DB transaction if Redis fails or the gate is disabled", async () => {
  f.reserve.mockRejectedValue(new Error("Redis down"));
  await createGatedBooking("user", input, log, "c");
  expect(f.create).toHaveBeenCalledTimes(1); expect(f.settle).not.toHaveBeenCalled();
  f.env.INVENTORY_GATE_ENABLED = false; f.reserve.mockClear();
  await createGatedBooking("user", input, log, "c");
  expect(f.reserve).not.toHaveBeenCalled(); expect(f.create).toHaveBeenCalledTimes(2);
});
it("a missing event still reaches the original DB error path", async () => {
  f.reserve.mockResolvedValue(-1); f.event.mockResolvedValue(undefined);
  await createGatedBooking("user", input, log, "c");
  expect(f.initialize).not.toHaveBeenCalled(); expect(f.create).toHaveBeenCalledOnce();
});

it("denied gates retain 400/404 semantics when an event starts or disappears", async () => {
  f.reserve.mockResolvedValue(0);
  f.event.mockResolvedValueOnce(undefined);
  await expect(createGatedBooking("user", input, log, "c")).rejects.toMatchObject({ kind: "NOT_FOUND" });
  f.event.mockResolvedValueOnce({ startsAt: new Date("2000-01-01") });
  await expect(createGatedBooking("user", input, log, "c")).rejects.toMatchObject({ kind: "BAD_REQUEST" });
  expect(f.create).not.toHaveBeenCalled();
});

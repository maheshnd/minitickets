import { beforeEach, describe, expect, it, vi } from "vitest";

const { listBookings, listTickets, sign } = vi.hoisted(() => ({ listBookings: vi.fn(), listTickets: vi.fn(), sign: vi.fn() }));
vi.mock("../queries/bookings", () => ({ listByUser: listBookings }));
vi.mock("../queries/tickets", () => ({ listByUser: listTickets }));
vi.mock("../queries/assets", () => ({ ASSET_URL_SECONDS: 120, signAssetGet: sign }));
const { mine } = await import("./tickets");
const owner = "10000000-0000-4000-8000-000000000001";
const booking = { id: "20000000-0000-4000-8000-000000000002", eventId: "30000000-0000-4000-8000-000000000003",
  quantity: 2, status: "confirmed", createdAt: new Date("2026-10-15T18:00:00.000Z"),
  event: { title: "Show", venue: "Hall", startsAt: new Date("2027-01-01T18:00:00.000Z") } };
const ticket = { bookingId: booking.id, eventId: booking.eventId, userId: owner, ticketId: `${booking.id}:1`,
  seat: 1, status: "ready", objectKey: `tickets/${booking.id}/1.png`, qrToken: "private-bearer-token" };
beforeEach(() => {
  vi.clearAllMocks(); listBookings.mockResolvedValue([booking]); listTickets.mockResolvedValue([]);
  sign.mockResolvedValue("https://s3.example.test/signed");
});

describe("tickets.mine", () => {
  it("keeps a confirmed booking visible while asynchronous QR records are absent", async () => {
    const [result] = await mine(owner);
    expect(result).toMatchObject({ id: booking.id, quantity: 2, creationStatus: "creating", tickets: [] });
    expect(listBookings).toHaveBeenCalledWith(owner); expect(listTickets).toHaveBeenCalledWith(owner);
    expect(sign).not.toHaveBeenCalled();
  });
  it("shows partial completion, signs short-lived links, and exposes no token or storage key", async () => {
    listTickets.mockResolvedValue([ticket, { ...ticket, seat: 2, status: "creating" }]);
    const [result] = await mine(owner);
    expect(result.creationStatus).toBe("creating"); expect(result.tickets).toHaveLength(1);
    expect(sign).toHaveBeenCalledWith(ticket.objectKey);
    expect(sign).toHaveBeenCalledWith(ticket.objectKey, `ticket-${booking.id}-1.png`);
    expect(Date.parse(result.tickets[0].expiresAt) - Date.now()).toBeGreaterThan(119_000);
    expect(JSON.stringify(result)).not.toContain(ticket.qrToken);
    expect(result.tickets[0]).not.toHaveProperty("objectKey"); expect(result.tickets[0]).not.toHaveProperty("userId");
  });
  it("marks a complete booking ready and sorts seats", async () => {
    listTickets.mockResolvedValue([{ ...ticket, seat: 2, ticketId: `${booking.id}:2`, objectKey: `tickets/${booking.id}/2.png` }, ticket]);
    const [result] = await mine(owner);
    expect(result.creationStatus).toBe("ready"); expect(result.tickets.map(ticket => ticket.seat)).toEqual([1, 2]);
  });
  it.each([{ userId: "foreign-owner" }, { objectKey: "posters/secret.png" }, { eventId: "other-event" },
    { seat: 3 }, { ticketId: "another-booking:1" }])("refuses a corrupt/foreign record before signing its key", async change => {
    listTickets.mockResolvedValue([{ ...ticket, ...change }]);
    await expect(mine(owner)).rejects.toThrow("invalid ticket ownership or key");
    expect(sign).not.toHaveBeenCalled();
  });
  it("ignores orphan records that do not belong to any of the user's bookings", async () => {
    listTickets.mockResolvedValue([{ ...ticket, bookingId: "other-booking" }]);
    expect((await mine(owner))[0].tickets).toEqual([]); expect(sign).not.toHaveBeenCalled();
  });
});

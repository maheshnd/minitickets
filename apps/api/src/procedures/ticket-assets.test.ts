import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "../trpc/context";

const { mine, start, complete, role } = vi.hoisted(() => ({ mine: vi.fn(), start: vi.fn(), complete: vi.fn(), role: vi.fn() }));
vi.mock("../services/tickets", () => ({ mine }));
vi.mock("../services/posters", () => ({ start, complete }));
vi.mock("../services/users", () => ({ getRole: role }));
const { createCallerFactory, router } = await import("../trpc/init");
const { ticketsRouter } = await import("./tickets");
const { postersRouter } = await import("./posters");
const app = router({ tickets: ticketsRouter, posters: postersRouter });
const eventId = "10000000-0000-4000-8000-000000000001";
const userId = "20000000-0000-4000-8000-000000000002";
function caller(loggedIn = true) {
  return createCallerFactory(app)({ session: loggedIn ? { userId } : null,
    req: { log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } } } as unknown as Context);
}
beforeEach(() => { vi.clearAllMocks(); role.mockResolvedValue("user"); mine.mockResolvedValue([]); });

describe("ticket/asset authorization", () => {
  it("requires a session for ticket URLs and passes only its owner id", async () => {
    await expect(caller(false).tickets.mine()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(mine).not.toHaveBeenCalled();
    await caller().tickets.mine(); expect(mine).toHaveBeenCalledWith(userId);
    expect(role).not.toHaveBeenCalled();
  });
  it("requires admin on BOTH upload initiation and publication", async () => {
    await expect(caller().posters.start({ eventId, contentType: "image/png", byteLength: 64 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller().posters.complete({ eventId, uploadId: eventId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(start).not.toHaveBeenCalled(); expect(complete).not.toHaveBeenCalled();
  });
  it("refuses an admin's oversized request before signing", async () => {
    role.mockResolvedValue("admin");
    await expect(caller().posters.start({ eventId, contentType: "image/png", byteLength: 2 * 1024 * 1024 + 1 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(start).not.toHaveBeenCalled();
  });
});

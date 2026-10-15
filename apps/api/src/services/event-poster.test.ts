import { beforeEach, describe, expect, it, vi } from "vitest";

const { find, sign } = vi.hoisted(() => ({ find: vi.fn(), sign: vi.fn() }));
vi.mock("../queries/events", () => ({ findById: find }));
vi.mock("../queries/events-cache", () => ({}));
vi.mock("../queries/web-cache", () => ({}));
vi.mock("../queries/assets", () => ({ signAssetGet: sign }));
vi.mock("../config/env", () => ({ env: { EVENTS_CACHE_SOFT_TTL_MS: 30_000, EVENTS_CACHE_HARD_TTL_MS: 300_000 } }));
const { getEvent } = await import("./events");
const id = "10000000-0000-4000-8000-000000000001";
const row = { id, title: "Show", venue: "Hall", startsAt: new Date("2027-01-01T18:00:00.000Z"), totalSeats: 10, seatsLeft: 8 };
beforeEach(() => { vi.clearAllMocks(); sign.mockResolvedValue("https://s3.example.test/poster"); });

describe("public event poster boundary", () => {
  it("signs only a published poster belonging to this event", async () => {
    const posterKey = `posters/${id}/image.png`;
    find.mockResolvedValue({ ...row, posterKey });
    expect((await getEvent(id)).posterUrl).toBe("https://s3.example.test/poster");
    expect(sign).toHaveBeenCalledWith(posterKey);
  });
  it.each(["tickets/private-booking/1.png", "poster-uploads/event/admin/staged"])("never signs private/staged data via a corrupt public poster key: %s", async posterKey => {
    find.mockResolvedValue({ ...row, posterKey });
    await expect(getEvent(id)).rejects.toThrow("invalid published poster key");
    expect(sign).not.toHaveBeenCalled();
  });
});

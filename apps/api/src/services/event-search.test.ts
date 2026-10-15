import { beforeEach, expect, it, vi } from "vitest";
import { SearchEventsInput } from "@minitickets/shared";
const search = vi.fn();
vi.mock("../queries/event-search", () => ({ search: (...args: unknown[]) => search(...args) }));
const { searchEvents } = await import("./event-search");
const now = new Date("2026-10-15T00:00:00Z");
const row = (id: string) => ({ id, title: "Show", venue: "Pune", startsAt: new Date("2027-01-01T00:00:00Z"),
  cursorAt: "2027-01-01T00:00:00.000123Z", totalSeats: 10, seatsLeft: 8 });
beforeEach(() => search.mockReset());
it("uses the last returned tuple, preserves SQL precision and strips the lookahead row", async () => {
  search.mockResolvedValue([row("a"), row("b"), row("c")]);
  const result = await searchEvents(SearchEventsInput.parse({ q: " Show ", venue: " PUNE ", limit: 2 }), now);
  expect(result.items.map(item => item.id)).toEqual(["a", "b"]);
  expect(result.nextCursor).toEqual({ startsAt: "2027-01-01T00:00:00.000123Z", id: "b", asOf: now.toISOString() });
  expect(result.items[0]).not.toHaveProperty("cursorAt");
  expect(search.mock.calls[0][1]).toEqual({ venue: "pune" });
});
it("keeps the traversal cutoff and ends without an extra empty page", async () => {
  const cursor = { startsAt: "2027-01-01T00:00:00.000123Z", id: "00000000-0000-4000-8000-000000000001", asOf: now.toISOString() };
  search.mockResolvedValue([row("b")]);
  expect((await searchEvents(SearchEventsInput.parse({ cursor, limit: 1 }), new Date("2026-11-01"))).nextCursor).toBeNull();
  expect(search.mock.calls[0][2]).toBe(cursor.asOf);
  search.mockResolvedValue([]);
  expect((await searchEvents(SearchEventsInput.parse({}), now)).items).toEqual([]);
});

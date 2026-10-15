import { expect, it } from "vitest";
import { SearchEventsInput } from "./event-search";
it("bounds search, pages and inherited date filters at the API boundary", () => {
  expect(SearchEventsInput.parse({ q: "  jazz  " })).toEqual({ q: "jazz", limit: 50 });
  for (const input of [{ limit: 0 }, { limit: 101 }, { limit: 1.2 }, { q: "x".repeat(201) },
    { cursor: { startsAt: "bad", id: "bad", asOf: "bad" } }, { from: "2026-12-01", to: "2026-11-01" }]) {
    expect(SearchEventsInput.safeParse(input).success).toBe(false);
  }
});

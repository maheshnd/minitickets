import { describe, expect, it } from "vitest";
import { canonicalFilters, canonicalString } from "./event-filters";

// The canonical form decides which requests share a cache entry. Pure functions: no fakes needed.
const canonical = (input: Parameters<typeof canonicalFilters>[0]) => canonicalString(canonicalFilters(input));

describe("canonicalFilters + canonicalString", () => {
  it('" Pune", "pune" and "PUNE" are the same', () => {
    expect(canonical({ venue: " Pune" })).toBe('{"venue":"pune"}');
    expect(canonical({ venue: "pune" })).toBe('{"venue":"pune"}');
    expect(canonical({ venue: "PUNE" })).toBe('{"venue":"pune"}');
  });

  it("different venues or different days are different", () => {
    expect(canonical({ venue: "pune" })).not.toBe(canonical({ venue: "mumbai" }));
    expect(canonical({ from: "2026-11-20" })).not.toBe(canonical({ from: "2026-11-21" }));
    expect(canonical({ from: "2026-11-20" })).not.toBe(canonical({ to: "2026-11-20" }));
  });

  it("empty filters are the same as no filters", () => {
    expect(canonical(undefined)).toBe("{}");
    expect(canonical({})).toBe("{}");
    expect(canonical({ venue: "" })).toBe("{}");
    expect(canonical({ venue: "   " })).toBe("{}");
  });

  it("rounds dates down to the start of the UTC day", () => {
    expect(canonicalFilters({ from: "2026-11-20T23:59:59.999Z" }).from).toEqual(new Date("2026-11-20T00:00:00.000Z"));
    expect(canonical({ from: "2026-11-20T18:30:00.000Z" })).toBe(canonical({ from: "2026-11-20" }));
  });

  it("sorts the fields, whatever order they came in", () => {
    expect(canonical({ venue: "Pune", to: "2026-11-30", from: "2026-11-01" })).toBe(
      '{"from":"2026-11-01","to":"2026-11-30","venue":"pune"}',
    );
  });

  it("a venue with quotes, '&' or '=' cannot pretend to be another field (JSON escapes it)", () => {
    const tricky = canonical({ venue: 'a","to":"2026-11-30' });
    expect(tricky).not.toBe(canonical({ venue: "a", to: "2026-11-30" }));
    expect(JSON.parse(tricky)).toEqual({ venue: 'a","to":"2026-11-30' });
  });
});

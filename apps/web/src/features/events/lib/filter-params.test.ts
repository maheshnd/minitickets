import { describe, expect, it } from "vitest";
import { filtersHref, hasFilters, noFilters, parseFilters, readFilterParams } from "./filter-params";

describe("readFilterParams", () => {
  it("reads venue, from and to; missing ones are empty", () => {
    expect(readFilterParams({ venue: "Pune", from: "2026-11-01" })).toEqual({ venue: "Pune", from: "2026-11-01", to: "" });
  });

  it("takes the first value when a param is repeated", () => {
    expect(readFilterParams({ venue: ["Pune", "Mumbai"] }).venue).toBe("Pune");
  });
});

describe("parseFilters", () => {
  it("no filters -> an empty input (all upcoming events)", () => {
    expect(parseFilters(noFilters)).toEqual({ success: true, input: {} });
  });

  it("leaves out empty fields and trims the venue", () => {
    expect(parseFilters({ venue: "  Pune ", from: "", to: "2026-11-30" })).toEqual({
      success: true,
      input: { venue: "Pune", to: "2026-11-30" },
    });
  });

  it("returns the shared schema's message per field", () => {
    expect(parseFilters({ venue: "", from: "2026-11-30", to: "2026-11-01" })).toEqual({
      success: false,
      errors: { to: "'To' must be on or after 'From'" },
    });
    expect(parseFilters({ venue: "", from: "banana", to: "" })).toEqual({
      success: false,
      errors: { from: "Enter a valid date" },
    });
  });
});

describe("filtersHref", () => {
  it("no filters -> /events", () => {
    expect(filtersHref(noFilters)).toBe("/events");
    expect(filtersHref({ venue: "   ", from: "", to: "" })).toBe("/events");
  });

  it("only the fields that are set, venue trimmed and URL-encoded", () => {
    expect(filtersHref({ venue: " Rock & Roll ", from: "2026-11-01", to: "" })).toBe("/events?venue=Rock+%26+Roll&from=2026-11-01");
  });

  it("round-trips through readFilterParams", () => {
    const values = { venue: "Rock & Roll", from: "2026-11-01", to: "2026-11-30" };
    const params = Object.fromEntries(new URLSearchParams(filtersHref(values).split("?")[1]));
    expect(readFilterParams(params)).toEqual(values);
  });
});

describe("hasFilters", () => {
  it("is false for empty or only-space values, true otherwise", () => {
    expect(hasFilters(noFilters)).toBe(false);
    expect(hasFilters({ venue: "  ", from: "", to: "" })).toBe(false);
    expect(hasFilters({ venue: "", from: "", to: "2026-11-30" })).toBe(true);
  });
});

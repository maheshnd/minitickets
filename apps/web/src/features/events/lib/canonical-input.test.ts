import { describe, expect, it } from "vitest";
import { canonicalListInput } from "./canonical-input";

// The web cache key is JSON.stringify of this, so "same key" = "same JSON text".
const key = (input: Parameters<typeof canonicalListInput>[0]) => JSON.stringify(canonicalListInput(input));

describe("canonicalListInput", () => {
  it("no filters -> {}", () => {
    expect(canonicalListInput({})).toEqual({});
  });

  it("venue: case and spaces do not matter, empty venue is left out", () => {
    expect(key({ venue: " Pune " })).toBe(key({ venue: "PUNE" }));
    expect(canonicalListInput({ venue: "  The Foundry " })).toEqual({ venue: "the foundry" });
    expect(canonicalListInput({ venue: "   " })).toEqual({});
  });

  it("dates: only the UTC day counts", () => {
    expect(canonicalListInput({ from: "2026-11-20T18:30:00.000Z", to: "2026-11-30" })).toEqual({
      from: "2026-11-20",
      to: "2026-11-30",
    });
    expect(key({ from: "2026-11-20" })).toBe(key({ from: "2026-11-20T00:00:00.000Z" }));
  });

  it("the order the fields were given in does not change the key", () => {
    expect(key({ venue: "Pune", to: "2026-11-30", from: "2026-11-01" })).toBe(
      key({ from: "2026-11-01", to: "2026-11-30", venue: "pune" }),
    );
    expect(key({ venue: "Pune", from: "2026-11-01" })).toBe('{"from":"2026-11-01","venue":"pune"}');
  });

  it("different questions keep different keys", () => {
    expect(key({ venue: "Pune" })).not.toBe(key({ venue: "Mumbai" }));
    expect(key({ from: "2026-11-20" })).not.toBe(key({ to: "2026-11-20" }));
    expect(key({ from: "2026-11-20" })).not.toBe(key({ from: "2026-11-21" }));
  });
});

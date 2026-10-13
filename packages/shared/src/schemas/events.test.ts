import { describe, expect, it } from "vitest";
import { ListEventsInput } from "./events";

// The first issue's path and message, or null when the input is valid.
function firstIssue(input: unknown) {
  const result = ListEventsInput.safeParse(input);
  if (result.success) return null;
  const issue = result.error.issues[0]!;
  return { path: issue.path, message: issue.message };
}

describe("ListEventsInput", () => {
  it("accepts no filters at all", () => {
    expect(ListEventsInput.parse({})).toEqual({});
  });

  it("trims the venue", () => {
    expect(ListEventsInput.parse({ venue: "  Pune " }).venue).toBe("Pune");
  });

  it("accepts a plain day and a full UTC time", () => {
    expect(firstIssue({ from: "2026-11-20", to: "2026-11-21T18:30:00.000Z" })).toBeNull();
  });

  it("rejects a date that is not a date", () => {
    expect(firstIssue({ from: "next friday" })).toEqual({ path: ["from"], message: "Enter a valid date" });
    expect(firstIssue({ to: "2026-02-30" })).toEqual({ path: ["to"], message: "Enter a valid date" });
  });

  it("from after to -> validation error on 'to'", () => {
    expect(firstIssue({ from: "2026-11-21", to: "2026-11-20" })).toEqual({
      path: ["to"],
      message: "'To' must be on or after 'From'",
    });
  });

  it("from and to on the same day is fine (one day), even when 'to' has an earlier time", () => {
    expect(firstIssue({ from: "2026-11-20T18:00:00.000Z", to: "2026-11-20T09:00:00.000Z" })).toBeNull();
  });

  it("a range of exactly 1 year is fine; one day more -> validation error on 'to'", () => {
    expect(firstIssue({ from: "2026-11-20", to: "2027-11-20" })).toBeNull();
    expect(firstIssue({ from: "2026-11-20", to: "2027-11-21" })).toEqual({
      path: ["to"],
      message: "The date range can be at most 1 year",
    });
  });

  it("only one of the two dates: no range check", () => {
    expect(firstIssue({ from: "2026-11-20" })).toBeNull();
    expect(firstIssue({ to: "2030-01-01" })).toBeNull();
  });

  it("rejects a venue over 200 characters", () => {
    expect(firstIssue({ venue: "x".repeat(201) })?.path).toEqual(["venue"]);
  });
});

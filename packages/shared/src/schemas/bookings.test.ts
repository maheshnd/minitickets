import { describe, expect, it } from "vitest";
import { BookTicketInput } from "./bookings";

const EVENT_ID = "00000000-0000-4000-8000-000000000004";

// The first issue's path and message, or null when the input is valid.
function firstIssue(input: unknown) {
  const result = BookTicketInput.safeParse(input);
  if (result.success) return null;
  const issue = result.error.issues[0]!;
  return { path: issue.path, message: issue.message };
}

describe("BookTicketInput", () => {
  it("accepts 1 to 4 tickets", () => {
    for (const quantity of [1, 2, 3, 4]) expect(firstIssue({ eventId: EVENT_ID, quantity })).toBeNull();
  });

  it("rejects 0, 5 and part of a ticket", () => {
    expect(firstIssue({ eventId: EVENT_ID, quantity: 0 })).toEqual({ path: ["quantity"], message: "Book at least 1 ticket" });
    expect(firstIssue({ eventId: EVENT_ID, quantity: 5 })).toEqual({ path: ["quantity"], message: "At most 4 tickets per booking" });
    expect(firstIssue({ eventId: EVENT_ID, quantity: 1.5 })).toEqual({ path: ["quantity"], message: "Tickets must be a whole number" });
  });

  it("rejects an event id that is not a UUID", () => {
    expect(firstIssue({ eventId: "abc", quantity: 1 })).toEqual({ path: ["eventId"], message: "Unknown event" });
  });

  it("has no userId: whoever sends one, it is dropped (the API takes the user from the session)", () => {
    expect(BookTicketInput.parse({ eventId: EVENT_ID, quantity: 1, userId: "someone-else" })).toEqual({ eventId: EVENT_ID, quantity: 1 });
  });
});

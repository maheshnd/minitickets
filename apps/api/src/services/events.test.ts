import { beforeEach, describe, expect, it, vi } from "vitest";

// @concept: unit-tests
// 1. We replace the query layer with a tiny in-memory fake, so this test needs no database.
//    The fake does what the real SQL does (starts_at > now, oldest first), so we can check that
//    the service asks with the right time and turns the rows into the public shape.
//    The real SQL itself is checked by the e2e test against a real Postgres.
const allEvents = [
  { id: "c", title: "Later", venue: "V", startsAt: new Date("2026-12-01T10:00:00Z"), totalSeats: 10, seatsLeft: 0, createdAt: new Date() },
  { id: "a", title: "Past", venue: "V", startsAt: new Date("2026-01-01T10:00:00Z"), totalSeats: 10, seatsLeft: 5, createdAt: new Date() },
  { id: "b", title: "Soon", venue: "V", startsAt: new Date("2026-11-01T10:00:00Z"), totalSeats: 10, seatsLeft: 5, createdAt: new Date() },
];

const listUpcoming = vi.fn(async (now: Date) =>
  allEvents.filter((e) => e.startsAt > now).sort((x, y) => x.startsAt.getTime() - y.startsAt.getTime()),
);
vi.mock("../queries/events", () => ({ listUpcoming: (now: Date) => listUpcoming(now) }));

const { listUpcomingEvents } = await import("./events");

describe("listUpcomingEvents", () => {
  beforeEach(() => listUpcoming.mockClear());

  const now = new Date("2026-10-12T00:00:00Z");

  it("returns only events that start after now, soonest first", async () => {
    const result = await listUpcomingEvents(now);
    expect(result.map((e) => e.title)).toEqual(["Soon", "Later"]);
  });

  it("asks the query layer with the given time", async () => {
    await listUpcomingEvents(now);
    expect(listUpcoming).toHaveBeenCalledWith(now);
  });

  it("sends startsAt as an ISO string and leaves out createdAt", async () => {
    const [first] = await listUpcomingEvents(now);
    expect(first).toEqual({
      id: "b",
      title: "Soon",
      venue: "V",
      startsAt: "2026-11-01T10:00:00.000Z",
      totalSeats: 10,
      seatsLeft: 5,
    });
  });
});

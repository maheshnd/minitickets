import * as events from "../queries/events";

// Services: business logic. No HTTP and no SQL in here.

// Upcoming events for the public list.
export async function listUpcomingEvents(now: Date = new Date()) {
  // 1. "Upcoming" means "starts after right now". The clock is a parameter only so tests can set it.
  const rows = await events.listUpcoming(now);

  // 2. Pick the public fields by hand. startsAt becomes an ISO string (JSON has no Date type).
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    venue: row.venue,
    startsAt: row.startsAt.toISOString(),
    totalSeats: row.totalSeats,
    seatsLeft: row.seatsLeft,
  }));
}

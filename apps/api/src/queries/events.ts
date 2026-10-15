import { and, asc, eq, gt, gte, lt, sql } from "drizzle-orm";
import { db } from "../db/client";
import { events } from "../db/schema/events";

// @concept: layered-api
// @concept: indexing
// Queries: the only code that talks to the database. No business logic here.

const DAY_MS = 24 * 60 * 60 * 1000;

// P4. Attach only a server-generated verified poster key; the service owns validation.
export async function setPosterKey(id: string, posterKey: string) {
  const [row] = await db.update(events).set({ posterKey }).where(eq(events.id, id)).returning({ id: events.id });
  return row ?? null;
}

// 1. Events that have not started yet, soonest first, at most 50, matching the filters.
//    `now` is passed in (not read here) so the caller decides what "upcoming" means.
//    The index events_starts_at_idx (on starts_at) makes this cheap: the filter (> now), the sort
//    (order by starts_at) and the limit all use the same column, so Postgres jumps to "now" in the index
//    and stops after 50 rows instead of reading and sorting the whole table.
//    The date filters (step 1b) are ranges on starts_at too, so the same index serves them.
// 2. One debug line per query, so we can COUNT how often Postgres is really asked (cache stampede
//    demo: `pnpm demo:stampede`). Debug lines are hidden unless the API runs with LOG_LEVEL=debug.
//    `filters` is already canonical (services/event-filters.ts): the service decides what they mean.
export async function listUpcoming(
  now: Date,
  filters: { venue?: string; from?: Date; to?: Date },
  log: { debug: (msg: string) => void },
) {
  log.debug("db query: events.listUpcoming");

  // 1a. Always: only events that have not started yet.
  const conditions = [gt(events.startsAt, now)];

  // 1b. Dates (the service already rounded them to the start of a UTC day).
  //     from: starts on or after the start of that day.
  //     to:   starts BEFORE the start of the NEXT day, so the whole "to" day is included
  //           (to = 20 Nov includes an event at 20 Nov 23:59).
  if (filters.from) conditions.push(gte(events.startsAt, filters.from));
  if (filters.to) conditions.push(lt(events.startsAt, new Date(filters.to.getTime() + DAY_MS)));

  // 1c. Venue: EXACT match, ignoring case ("pune" finds "Pune", not "Pune Central").
  //     lower() on BOTH sides, so Postgres applies one set of lowercasing rules to both.
  //     The value is sent as a query parameter ($1), never pasted into the SQL text.
  //     INDEX NOTE (not added, the table is tiny): with many events, this would read every
  //     upcoming row and check its venue. The index that fits is an EXPRESSION index:
  //       CREATE INDEX events_venue_lower_starts_at_idx ON events (lower(venue), starts_at);
  //     lower(venue) first, because that is an equality (jump straight to "pune"); starts_at second,
  //     so inside "pune" the rows are already sorted by time for the > now range, the ORDER BY and
  //     the LIMIT. It must be lower(venue), not venue: an index on venue cannot answer lower(venue) = ...
  //     (A "contains" search, ILIKE '%pune%', could use neither; it would need a trigram index, pg_trgm.)
  if (filters.venue) conditions.push(sql`lower(${events.venue}) = lower(${filters.venue})`);

  return db
    .select()
    .from(events)
    .where(and(...conditions))
    .orderBy(asc(events.startsAt))
    .limit(50);
}

// 3. Insert one event and return the saved row (with its generated id and createdAt).
//    It is ONE statement outside any transaction, so Postgres commits it by itself ("autocommit"):
//    when this function returns, the row is saved and every other connection can see it.
//    The service relies on that: it invalidates the cache only after this returns.
//    The CHECK constraints on the table still refuse bad seat numbers, even if a caller forgets.
export async function create(input: {
  title: string;
  venue: string;
  startsAt: Date;
  totalSeats: number;
  seatsLeft: number;
}) {
  const rows = await db.insert(events).values(input).returning();
  return rows[0];
}

// 4. One event by its id (primary key), or undefined if there is none. Used by the event page.
//    It reads Postgres directly, never the cache: the page shows "seats left" next to the
//    "Book ticket" button, so it should be as fresh as possible. A primary-key lookup is about a
//    millisecond. (Booking itself never trusts this number either: it re-reads the row under a lock.)
export async function findById(id: string) {
  const rows = await db.select().from(events).where(eq(events.id, id)).limit(1);
  return rows[0];
}

import { asc, gt } from "drizzle-orm";
import { db } from "../db/client";
import { events } from "../db/schema/events";

// @concept: layered-api
// @concept: indexing
// Queries: the only code that talks to the database. No business logic here.

// 1. Events that have not started yet, soonest first, at most 50.
//    `now` is passed in (not read here) so the caller decides what "upcoming" means.
//    The index events_starts_at_idx (on starts_at) makes this cheap: the filter (> now), the sort
//    (order by starts_at) and the limit all use the same column, so Postgres jumps to "now" in the index
//    and stops after 50 rows instead of reading and sorting the whole table.
export async function listUpcoming(now: Date) {
  return db.select().from(events).where(gt(events.startsAt, now)).orderBy(asc(events.startsAt)).limit(50);
}

import { asc, gt } from "drizzle-orm";
import { db } from "../db/client";
import { events } from "../db/schema/events";

// @concept: layered-api
// Queries: the only code that talks to the database. No business logic here.

// 1. Events that have not started yet, soonest first, at most 50.
//    `now` is passed in (not read here) so the caller decides what "upcoming" means.
//    There is no index on starts_at yet: Postgres reads the whole table (a later step adds one).
export async function listUpcoming(now: Date) {
  return db.select().from(events).where(gt(events.startsAt, now)).orderBy(asc(events.startsAt)).limit(50);
}

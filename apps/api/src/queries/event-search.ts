import { and, asc, gt, gte, lt, sql } from "drizzle-orm";
import type { SearchEventsInput } from "@minitickets/shared";
import { db } from "../db/client";
import { events } from "../db/schema/events";

// 1. Escape LIKE metacharacters: the search text means literal text, not a wildcard program.
export function searchPattern(q: string) {
  return `%${q.replace(/[\\%_]/g, "\\$&")}%`;
}

export async function search(input: SearchEventsInput, filters: { venue?: string; from?: Date; to?: Date }, asOf: string) {
  const conditions = [gt(events.startsAt, new Date(asOf))];
  if (filters.from) conditions.push(gte(events.startsAt, filters.from));
  if (filters.to) conditions.push(lt(events.startsAt, new Date(filters.to.getTime() + 86_400_000)));
  if (filters.venue) conditions.push(sql`lower(${events.venue}) = lower(${filters.venue})`);
  // 2. This expression matches the trigram GIN index, including title/venue substring searches.
  if (input.q) conditions.push(sql`(${events.title} || ' ' || ${events.venue}) ilike ${searchPattern(input.q)}`);
  if (input.cursor) {
    conditions.push(sql`(${events.startsAt}, ${events.id}) > (${input.cursor.startsAt}::timestamptz, ${input.cursor.id}::uuid)`);
  }
  // 3. Fetch one extra row to detect a next page. Keyset skips no growing OFFSET prefix.
  return db.select({
    id: events.id, title: events.title, venue: events.venue, startsAt: events.startsAt,
    totalSeats: events.totalSeats, seatsLeft: events.seatsLeft,
    cursorAt: sql<string>`to_char(${events.startsAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
  }).from(events).where(and(...conditions))
    .orderBy(asc(events.startsAt), asc(events.id)).limit(input.limit + 1);
}

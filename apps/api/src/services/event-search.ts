import type { SearchEventsInput } from "@minitickets/shared";
import * as queries from "../queries/event-search";
import { canonicalFilters } from "./event-filters";

// @concept: keyset-pagination
export async function searchEvents(input: SearchEventsInput, now = new Date()) {
  // 1. Keep the upcoming cutoff stable throughout a traversal; this is not a DB snapshot.
  const asOf = input.cursor?.asOf ?? now.toISOString();
  const rows = await queries.search(input, canonicalFilters(input), asOf);
  const items = rows.slice(0, input.limit);
  const last = items.at(-1);
  // 2. Explicit public fields keep internal cursor precision out of each event DTO.
  return {
    items: items.map(row => ({ id: row.id, title: row.title, venue: row.venue,
      startsAt: row.startsAt.toISOString(), totalSeats: row.totalSeats, seatsLeft: row.seatsLeft })),
    nextCursor: rows.length > input.limit && last ? { startsAt: last.cursorAt, id: last.id, asOf } : null,
  };
}

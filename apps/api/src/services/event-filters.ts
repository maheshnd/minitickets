import type { ListEventsInput } from "@minitickets/shared";

// Turns the filters of an events.list request into their CANONICAL form: one fixed way of writing
// "the same question". Two requests that must get the same answer must get the same form.
//
// WHY: the canonical form is used for BOTH the Postgres query and the cache key. So
// " Pune", "pune" and "PUNE" share ONE cache entry (instead of three copies of the same list), and
// because the query uses the same form, everyone who shares that entry really asked the same
// question. (Rounding only the KEY but querying with the exact input would be a bug: two different
// questions would share one answer.)

// The canonical filters. A missing field means "no filter on that".
//   venue: trimmed and lowercased, never "" (an empty venue is left out);
//   from / to: the START of a UTC day (00:00:00.000Z). `to` means "up to the END of that day".
export type EventFilters = { venue?: string; from?: Date; to?: Date };

export function canonicalFilters(input: ListEventsInput | undefined): EventFilters {
  const filters: EventFilters = {};

  // 1. Venue: the shared schema already trimmed it; trim again so this function is safe on its
  //    own, then lowercase (the query compares without case). Empty = no venue filter.
  const venue = input?.venue?.trim().toLowerCase();
  if (venue) filters.venue = venue;

  // 2. Dates: round down to the start of the UTC day. "2026-11-20", "2026-11-20T00:00:00.000Z" and
  //    "2026-11-20T18:30:00.000Z" all become 2026-11-20T00:00:00.000Z. Without this, every
  //    millisecond would be its own cache key (86,400,000 possible keys per day instead of 1).
  if (input?.from) filters.from = startOfUtcDay(input.from);
  if (input?.to) filters.to = startOfUtcDay(input.to);

  return filters;
}

// 3. The canonical filters as ONE string, e.g. {"from":"2026-11-20","venue":"pune"}.
//    - fields in alphabetical order, so the order they were given in never matters
//      (JSON.stringify keeps the order in which keys were added, so we add them sorted);
//    - empty fields left out, so "no filters" and "empty filters" are both "{}";
//    - dates as days ("2026-11-20"), since only the day counts;
//    - JSON, not "a=b&c=d": JSON puts quotes around values and escapes them, so a venue with
//      "&", "=" or quotes in it can never look like another field.
//    The cache key is a short hash of this string (queries/events-cache.ts, upcomingKey).
export function canonicalString(filters: EventFilters): string {
  const sorted: Record<string, string> = {};
  if (filters.from) sorted.from = toDay(filters.from);
  if (filters.to) sorted.to = toDay(filters.to);
  if (filters.venue) sorted.venue = filters.venue;
  return JSON.stringify(sorted);
}

// Midnight UTC of the day `value` falls on. new Date("2026-11-20") already reads a plain day as UTC.
function startOfUtcDay(value: string): Date {
  const date = new Date(value);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

// "2026-11-20" from 2026-11-20T00:00:00.000Z.
function toDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

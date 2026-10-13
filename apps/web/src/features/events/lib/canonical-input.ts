import type { ListEventsInput } from "@minitickets/shared";

// The CANONICAL form of an events.list input: one fixed way of writing "the same question", so two
// questions that must get the same answer share ONE entry in the web server's cache
// (../server/cached-events.ts). The same idea as the API's canonical filters (Step 8,
// apps/api/src/services/event-filters.ts). The web app never imports API code at runtime, so the
// rules are written again here; they must stay the same as the API's:
//   - venue: trimmed and lowercased (the API compares venues without case); empty = left out;
//   - from / to: only the UTC DAY counts ("2026-11-20T18:30:00.000Z" -> "2026-11-20"), because the
//     API rounds both down to the start of their UTC day;
//   - fields added in alphabetical order (from, to, venue): the cache key is made with
//     JSON.stringify, which keeps the order fields were added in, so the order the URL had never matters.
// The cached function also SENDS this canonical input to the API (not the original one). So
// everyone who shares a cache entry really asked the same question, and got its answer.
export function canonicalListInput(input: ListEventsInput): ListEventsInput {
  const canonical: ListEventsInput = {};
  if (input.from) canonical.from = utcDay(input.from);
  if (input.to) canonical.to = utcDay(input.to);
  const venue = input.venue?.trim().toLowerCase();
  if (venue) canonical.venue = venue;
  return canonical;
}

// "2026-11-20" for "2026-11-20" or any time on that UTC day. new Date("2026-11-20") reads a plain
// day as UTC midnight, so both forms land on the same day.
function utcDay(value: string): string {
  return new Date(value).toISOString().slice(0, 10);
}

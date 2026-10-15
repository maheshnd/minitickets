import { z } from "zod";
import { EventSchema, ListEventsInput } from "./events";

// 1. A tuple cursor preserves tied times; six fractional digits retain Postgres precision.
export const EventSearchCursor = z.object({
  startsAt: z.iso.datetime(),
  id: z.uuid(),
  asOf: z.iso.datetime(),
});
export const SearchEventsInput = ListEventsInput.safeExtend({
  q: z.string().trim().max(200).default(""),
  limit: z.number().int().min(1).max(100).default(50),
  cursor: EventSearchCursor.nullish(),
});
export type SearchEventsInput = z.infer<typeof SearchEventsInput>;
// 2. Null means exhausted; no expensive count query is needed for an infinite list.
export const SearchEventsOutput = z.object({
  items: z.array(EventSchema),
  nextCursor: EventSearchCursor.nullable(),
});

import { z } from "zod";

// What the API sends for one event in the list.
export const EventSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  venue: z.string(),
  // ISO 8601 text in UTC, e.g. "2026-11-20T18:30:00.000Z". The browser formats it for the viewer.
  startsAt: z.string(),
  totalSeats: z.number().int(),
  seatsLeft: z.number().int(),
});

export type Event = z.infer<typeof EventSchema>;

// The output of events.list: an array of events.
export const ListEventsOutput = z.array(EventSchema);

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

// Input of events.create (admins only). The browser runs it for fast feedback; the API runs it again.
// There is no seatsLeft here: a new event always starts with every seat free (the service sets it).
export const CreateEventInput = z.object({
  // 1. Trim first, so a title of only spaces counts as empty. The max keeps silly input out of the list.
  title: z.string().trim().min(1, "Enter a title").max(200, "Title must be at most 200 characters"),
  venue: z.string().trim().min(1, "Enter a venue").max(200, "Venue must be at most 200 characters"),
  // 2. ISO 8601 text in UTC, the same format events.list sends, e.g. "2026-11-20T18:30:00.000Z".
  //    "In the future" is checked against the clock of whoever runs this schema. The browser's
  //    clock may be wrong, so the check that counts is the one on the API.
  startsAt: z.iso
    .datetime({ error: "Enter a start date and time" })
    .refine((value) => new Date(value).getTime() > Date.now(), "Start time must be in the future"),
  // 3. A whole number above 0. The database refuses 0 or less too (events_total_seats_positive).
  totalSeats: z
    .number({ error: "Enter the number of seats" })
    .int("Seats must be a whole number")
    .min(1, "There must be at least 1 seat")
    .max(100_000, "At most 100,000 seats"),
});

export type CreateEventInput = z.infer<typeof CreateEventInput>;

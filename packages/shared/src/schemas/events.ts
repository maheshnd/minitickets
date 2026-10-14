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

// Input of events.byId (the event page, /events/<id>). The web page checks the id from the URL with
// this first: a malformed id is a "not found" page without asking the API.
export const GetEventInput = z.object({ id: z.uuid() });

export type GetEventInput = z.infer<typeof GetEventInput>;

// 1. A filter date: a day ("2026-11-20", what <input type="date"> gives) or a full UTC time
//    ("2026-11-20T18:30:00.000Z"). The API works in WHOLE UTC DAYS: it rounds a time down to the
//    start of its day, so both examples mean "from (or to) 20 November".
const FilterDate = z.union([z.iso.date(), z.iso.datetime()], { error: "Enter a valid date" });

// The start of the UTC day of a FilterDate, in ms since 1970. Only used by the checks below.
function utcDay(value: string): number {
  const date = new Date(value);
  date.setUTCHours(0, 0, 0, 0);
  return date.getTime();
}

// Input of events.list. Every field is optional; no fields = all upcoming events.
// The browser runs it for fast feedback (and on the URL's search params); the API runs it again.
export const ListEventsInput = z
  .object({
    // 2. Trimmed, so " Pune" is "Pune". An empty venue ("" or only spaces) means "any venue".
    venue: z.string().trim().max(200, "Venue must be at most 200 characters").optional(),
    from: FilterDate.optional(),
    to: FilterDate.optional(),
  })
  // 3. Both dates given: "from" must not be after "to" (the same day is fine: one day).
  .refine((input) => !input.from || !input.to || utcDay(input.from) <= utcDay(input.to), {
    message: "'To' must be on or after 'From'",
    path: ["to"],
  })
  // 4. ...and at most 1 year apart. This bounds how many different date pairs (so cache keys)
  //    one "from" day can have: at most 366 "to" days (see the API's services/events.ts, step 1b).
  .refine(
    (input) => {
      if (!input.from || !input.to) return true;
      const limit = new Date(utcDay(input.from));
      limit.setUTCFullYear(limit.getUTCFullYear() + 1);
      return utcDay(input.to) <= limit.getTime();
    },
    { message: "The date range can be at most 1 year", path: ["to"] },
  );

export type ListEventsInput = z.infer<typeof ListEventsInput>;

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

import { z } from "zod";

// 1. The most tickets one booking may hold. The database has the same limit as a CHECK constraint
//    (apps/api/src/db/schema/bookings.ts), and the web form offers exactly 1 to this number.
export const MAX_TICKETS_PER_BOOKING = 4;

// Input of bookings.create. The browser runs it for fast feedback; the API runs it again.
// The user is NOT part of the input: the API takes them from the session, so nobody can book in
// someone else's name by sending another userId.
export const BookTicketInput = z.object({
  eventId: z.uuid("Unknown event"),
  quantity: z
    .number({ error: "Choose how many tickets" })
    .int("Tickets must be a whole number")
    .min(1, "Book at least 1 ticket")
    .max(MAX_TICKETS_PER_BOOKING, `At most ${MAX_TICKETS_PER_BOOKING} tickets per booking`),
});

export type BookTicketInput = z.infer<typeof BookTicketInput>;

// 2. A booking's status. Only "confirmed" today (more later, e.g. "cancelled"). Same list as the
//    CHECK constraint in the database.
export const BookingStatus = z.enum(["confirmed"]);

// 3. What the API sends for one booking (the answer of bookings.create).
export const BookingSchema = z.object({
  id: z.uuid(),
  eventId: z.uuid(),
  quantity: z.number().int(),
  status: BookingStatus,
  // ISO 8601 text in UTC, like every date the API sends.
  createdAt: z.string(),
});

export type Booking = z.infer<typeof BookingSchema>;

// 4. One row of "My tickets": the booking plus the few event fields the list shows.
//    The API reads them in the same query as the booking (a join), see queries/bookings.ts.
export const MyTicketSchema = BookingSchema.extend({
  event: z.object({
    title: z.string(),
    venue: z.string(),
    startsAt: z.string(),
  }),
});

export type MyTicket = z.infer<typeof MyTicketSchema>;

// The output of bookings.mine: the logged-in user's bookings, newest first.
export const MyTicketsOutput = z.array(MyTicketSchema);

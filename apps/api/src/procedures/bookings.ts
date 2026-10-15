import { BookingSchema, BookTicketInput, MyTicketsOutput } from "@minitickets/shared";
import { enforceRateLimit } from "../services/rate-limits";
import * as bookingsService from "../services/bookings";
import { protectedProcedure, router } from "../trpc/init";

// Procedures: validate input, call a service, return. No logic here.
export const bookingsRouter = router({
  // 1. protectedProcedure: 401 if not logged in. The user comes from the SESSION, never from the
  //    input, so nobody can book in someone else's name.
  // 2. The same schema the booking form uses in the browser (eventId, 1-4 tickets, idempotency
  //    key); the server never trusts that check.
  // 3. A mutation (POST): it changes data, so it is never cached and never sent by a prefetch.
  // 4. ctx.req.id is this request's correlation id (app.ts 1b2): the service puts it into the queue
  //    message, so the worker's log lines carry it too (P2).
  create: protectedProcedure
    .input(BookTicketInput)
    .output(BookingSchema)
    .mutation(async ({ input, ctx }) => {
      await enforceRateLimit("booking", ctx.session.userId);
      return bookingsService.bookTicket(ctx.session.userId, input, ctx.req.log, ctx.req.id);
    }),

  // 1. The logged-in user's own bookings ("My tickets"). No input: whose bookings is decided by the
  //    session, so one user can never ask for another user's list.
  // 2. .output() makes sure only the listed fields can leave.
  mine: protectedProcedure
    .output(MyTicketsOutput)
    .query(({ ctx }) => bookingsService.myTickets(ctx.session.userId)),
});

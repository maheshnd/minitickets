import { BookingSchema, BookTicketInput, MyTicketsOutput } from "@minitickets/shared";
import * as bookingsService from "../services/bookings";
import { protectedProcedure, router } from "../trpc/init";

// Procedures: validate input, call a service, return. No logic here.
export const bookingsRouter = router({
  // 1. protectedProcedure: 401 if not logged in. The user comes from the SESSION, never from the
  //    input, so nobody can book in someone else's name.
  // 2. The same schema the booking form uses in the browser (eventId, 1-4 tickets, idempotency
  //    key); the server never trusts that check.
  // 3. A mutation (POST): it changes data, so it is never cached and never sent by a prefetch.
  create: protectedProcedure
    .input(BookTicketInput)
    .output(BookingSchema)
    .mutation(({ input, ctx }) => bookingsService.bookTicket(ctx.session.userId, input, ctx.req.log)),

  // 1. The logged-in user's own bookings ("My tickets"). No input: whose bookings is decided by the
  //    session, so one user can never ask for another user's list.
  // 2. .output() makes sure only the listed fields can leave.
  mine: protectedProcedure
    .output(MyTicketsOutput)
    .query(({ ctx }) => bookingsService.myTickets(ctx.session.userId)),
});

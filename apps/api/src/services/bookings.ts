import type { BookTicketInput, Booking, MyTicket } from "@minitickets/shared";
import { ConflictError } from "../errors";
import * as bookings from "../queries/bookings";
// The events service owns the events caches, so we reuse its invalidation instead of touching
// Redis from here (a service never talks to a data store itself).
import { invalidateEventLists, type Log } from "./events";

// Services: business logic. No HTTP and no SQL in here.

// The public fields of a booking. createdAt becomes ISO text (JSON has no Date type).
function toPublicBooking(booking: { id: string; eventId: string; quantity: number; status: Booking["status"]; createdAt: Date }): Booking {
  return {
    id: booking.id,
    eventId: booking.eventId,
    quantity: booking.quantity,
    status: booking.status,
    createdAt: booking.createdAt.toISOString(),
  };
}

// Book tickets for the logged-in user (protectedProcedure already checked the session).
// Idempotent per (user, idempotency key): sending the same booking again returns the first one.
export async function bookTicket(userId: string, input: BookTicketInput, log: Log): Promise<Booking> {
  // 1. The whole booking is ONE database transaction with a row lock (queries/bookings.ts,
  //    createBookingTx). It throws NotFoundError (404), BadRequestError (400, already started) or
  //    ConflictError (409, not enough seats); we let them pass: the errorMapper turns them into
  //    HTTP codes, and the web page shows their message.
  //    When it returns "created", the booking and the new seat count are COMMITTED (visible to
  //    everyone). When it returns "existing", this user already has a booking with this key and
  //    NOTHING was written.
  const result = await bookings.createBookingTx(input.eventId, userId, input.quantity, input.idempotencyKey);

  // 2. A key we have seen before. Is it the SAME booking again (a retry, a double click), or did
  //    the client reuse the key for something else?
  //    - same event and same quantity: a replay. Answer exactly what the first request answered
  //      (the same booking id), so a client whose first response was lost cannot tell the
  //      difference. No cache invalidation: no seats changed.
  //    - anything different: refuse with 409. Returning the old booking would make the client
  //      believe it booked something it did not; booking anew would break "one key, one booking".
  //      The fix on the client side is a new key (the web form makes one per intent).
  if (result.kind === "existing") {
    const sameRequest = result.booking.eventId === input.eventId && result.booking.quantity === input.quantity;
    if (!sameRequest) throw new ConflictError("This idempotency key was already used for a different booking");
    log.debug(`booking ${result.booking.id} replayed for a repeated idempotency key`);
    return toPublicBooking(result.booking);
  }

  // 3. seats_left changed, so every cached events list is now out of date. Invalidate them, the same
  //    way creating an event does (Redis generation bump, then the web server's data cache), so
  //    /events shows the new number at once. AFTER the commit (write first, then invalidate; see
  //    invalidateUpcomingList in ./events.ts for why that order). If the booking failed, step 1
  //    threw and nothing is invalidated: nothing changed (same for a replay, step 2).
  //    It never throws: if Redis is down, the booking still succeeds and the list is stale for up
  //    to one soft TTL (~30 s).
  //    TRADE-OFF: today every booking empties EVERY cached list (all filters). With many bookings
  //    per second, the cache would be emptied constantly: almost every events.list would be a miss
  //    and go to Postgres, so the cache would stop protecting it. Fine at our traffic. Options
  //    later: do not invalidate on bookings and accept seat counts up to one soft TTL old (booking
  //    re-checks under the lock anyway), or cache the seat counts apart from the list.
  await invalidateEventLists(log);

  // 4. Pick the public fields by hand (no userId, no idempotency key: the client has its key).
  return toPublicBooking(result.booking);
}

// The logged-in user's bookings ("My tickets"), newest first, each with its event's details.
// One query (a join, see queries/bookings.ts listByUser), not one per booking.
export async function myTickets(userId: string): Promise<MyTicket[]> {
  const rows = await bookings.listByUser(userId);
  return rows.map((row) => ({
    id: row.id,
    eventId: row.eventId,
    quantity: row.quantity,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    event: { title: row.event.title, venue: row.event.venue, startsAt: row.event.startsAt.toISOString() },
  }));
}

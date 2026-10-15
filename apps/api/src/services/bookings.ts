import type { BookTicketInput, Booking, MyTicket } from "@minitickets/shared";
import { randomUUID } from "node:crypto";
import { ConflictError } from "../errors";
import * as bookings from "../queries/bookings";
import * as users from "../queries/users";
// The jobs queue (queues/ = the layer for message queues, like queries/ for databases).
import * as jobs from "../queues/jobs";
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
// correlationId: this request's id (P2, apps/api/src/http/correlation-id.ts). `log` already writes it
// on our own lines; the confirmation message carries it on to the worker (step 4).
export async function bookTicket(userId: string, input: BookTicketInput, log: Log, correlationId: string): Promise<Booking> {
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

  // 4. Tell the background worker to send the confirmation email. Only here: a NEW booking got this
  //    far; a replay returned in step 2 and sends nothing, so a retry never means a second email.
  //    We do not wait for the email, only for the queue to accept the message (a few ms).
  await publishConfirmation(userId, input.quantity, result, log, correlationId);

  // 5. Pick the public fields by hand (no userId, no idempotency key: the client has its key).
  return toPublicBooking(result.booking);
}

// Put a "booking confirmed" message on the jobs queue. NEVER throws: the booking is already
// committed, and a slow or broken queue must not turn it into an error the user sees.
//
// HONEST LIMIT (a known gap): the commit and the publish are two separate steps with nothing
// joining them. If the publish fails, or the process crashes right after the commit, the booking
// exists and its message does not: no email, and nobody notices. The fix is the OUTBOX PATTERN:
// write the message into an `outbox` table in the SAME transaction as the booking, and let a
// relay publish it from there (so it is committed or rolled back together with the booking). It is
// on the roadmap as a later step; today we accept the gap and log an error.
async function publishConfirmation(
  userId: string,
  quantity: number,
  created: Extract<bookings.CreateBookingResult, { kind: "created" }>,
  log: Log,
  correlationId: string,
): Promise<void> {
  // 1. Publishing is off when JOBS_QUEUE_URL is not set (startup warning in server.ts).
  if (!jobs.jobsEnabled) return;
  try {
    // 2. The email address lives on the user, not on the booking: one lookup by primary key.
    const user = await users.findById(userId);
    if (!user) throw new Error("user not found");
    // 3. Build the message with everything the email needs (see packages/shared/src/schemas/jobs.ts),
    //    plus this request's correlation id (P2), so the worker's log lines can be found together
    //    with this request's lines: one search follows the booking end to end.
    const message = {
      type: "booking.confirmed" as const,
      version: 1 as const,
      messageId: randomUUID(),
      bookingId: created.booking.id,
      userEmail: user.email,
      eventTitle: created.event.title,
      eventVenue: created.event.venue,
      eventStartsAt: created.event.startsAt.toISOString(),
      quantity,
      occurredAt: new Date().toISOString(),
      correlationId,
    };
    await jobs.publishBookingConfirmed(message);
    // 4. Log ids only, never the message: it holds an email address (personal data).
    log.info(`published booking.confirmed messageId=${message.messageId} bookingId=${message.bookingId}`);
  } catch (err) {
    // 5. Log the error without the address: the booking id is enough to find the booking.
    log.error({ err, bookingId: created.booking.id }, "could not publish booking.confirmed; the booking succeeded but no email will be sent");
  }
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

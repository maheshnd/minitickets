import { desc, eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import { bookings } from "../db/schema/bookings";
import { events } from "../db/schema/events";
import { BadRequestError, ConflictError, NotFoundError } from "../errors";

// Queries: the only code that talks to the database. No business logic here.
// ONE exception, on purpose: the three checks in createBookingTx (step 2). They must run INSIDE the
// transaction, while the event row is locked, and a service cannot hold a transaction (services
// never see SQL). Checked anywhere else, the answer could be out of date by the time we write.

// Postgres error code for "check_violation", and the constraint that keeps seats_left >= 0
// (apps/api/src/db/schema/events.ts).
const CHECK_VIOLATION = "23514";
const SEATS_LEFT_CHECK = "events_seats_left_not_negative";

// Drizzle wraps driver errors and keeps the original in `.cause` (same as in ./users.ts), so the
// Postgres code and constraint name may be on the error or on its cause.
function isSeatsLeftCheckViolation(err: unknown): boolean {
  const pgError = (e: unknown) =>
    typeof e === "object" && e !== null && "code" in e ? (e as { code: unknown; constraint?: unknown }) : undefined;
  const found = pgError(err) ?? pgError((err as { cause?: unknown } | null)?.cause);
  return found?.code === CHECK_VIOLATION && found.constraint === SEATS_LEFT_CHECK;
}

// Book `quantity` seats of one event for one user, in ONE transaction. Returns the new booking row.
//
// THE BUG THIS PREVENTS (the "lost update" race): booking is read-then-write. Without a lock, two
// requests for the last seat can both READ "1 seat left", both decide "enough", and both WRITE.
//   A: read seats_left = 1 ........ write seats_left = 0, insert booking
//   B:      read seats_left = 1 ........ write seats_left = 0, insert booking
// Two bookings, one seat, and B's write silently replaced A's (A's update is "lost").
// `pnpm demo:booking-race --unsafe` makes this happen on purpose.
//
// A TRANSACTION means: every statement between BEGIN and COMMIT counts together, or none of them do.
// If anything fails (one of our checks below, the insert, a crash), Postgres ROLLS BACK: the seat
// count and the booking stay exactly as they were. So there is never a seat taken without a
// booking, or a booking without its seat taken. Drizzle runs BEGIN for us, COMMIT when the
// function returns, and ROLLBACK (then re-throws) when it throws.
export async function createBookingTx(eventId: string, userId: string, quantity: number) {
  try {
    return await db.transaction(async (tx) => {
      // 1. Read the event AND lock its row: SELECT ... FROM events WHERE id = $1 FOR UPDATE.
      //    WHAT THE LOCK DOES: from now until our COMMIT or ROLLBACK, no other transaction can lock,
      //    update or delete THIS row. It is a lock on one row only, not on the table.
      //    WHO WAITS: another booking for the SAME event reaches its own FOR UPDATE and stops there
      //    (it queues) until we finish. It then reads the row AGAIN, with our new seats_left
      //    (Postgres re-reads a locked row after the wait, even in the default isolation level,
      //    READ COMMITTED). Bookings for OTHER events never wait for us, and neither do plain
      //    reads like events.list: Postgres keeps the old version of the row for them (MVCC), so
      //    readers never wait for writers.
      //    WHY THIS PREVENTS OVERSELLING: the read below and the write in step 3 happen with nobody
      //    able to change the row in between. Bookings for one event run one after another, each
      //    one seeing the previous one's result, so the check in step 2 is never out of date.
      //    The COST: a hugely popular event becomes a queue on one row ("hot row"): every booking
      //    for it waits its turn, a few milliseconds each. Fine at our size; at a real ticket
      //    on-sale it is the bottleneck (then: split the seats over several rows, or queue requests).
      //    Each waiting booking also keeps one pool connection busy (the pool has 10, db/client.ts).
      const [event] = await tx
        .select({ startsAt: events.startsAt, seatsLeft: events.seatsLeft })
        .from(events)
        .where(eq(events.id, eventId))
        .for("update");

      // 2. The checks, on the LOCKED row, so their answer stays true until we commit.
      //    Throwing here rolls the transaction back (nothing was written yet) and releases the lock.
      //    "Already started" uses this server's clock. The order matters for the message: a
      //    sold-out event that has already started says "already started".
      if (!event) throw new NotFoundError("Event not found");
      if (event.startsAt.getTime() <= Date.now()) throw new BadRequestError("This event has already started");
      if (event.seatsLeft < quantity) throw new ConflictError("Not enough seats left");

      // 3. Take the seats. `seats_left - quantity` is computed BY POSTGRES from the row's current
      //    value, not from the number we read in step 1. With the lock, both are the same. But if a
      //    later change ever broke the lock, this form plus the CHECK constraint below still stops an
      //    oversell (seats_left would go below 0, and Postgres refuses that), while writing the number
      //    we computed ourselves would silently lose the other booking's update.
      await tx
        .update(events)
        .set({ seatsLeft: sql`${events.seatsLeft} - ${quantity}` })
        .where(eq(events.id, eventId));

      // 4. Save the booking and return it (with its generated id and createdAt).
      //    It becomes visible to other connections only at COMMIT, together with the new seat count.
      const [booking] = await tx.insert(bookings).values({ eventId, userId, quantity }).returning();
      return booking;
    });
  } catch (err) {
    // 5. THE LAST SAFETY NET: the CHECK constraint events_seats_left_not_negative (seats_left >= 0).
    //    With the lock above it never fires. If it ever does (a bug, a script that skipped the lock),
    //    Postgres has refused the update and rolled the transaction back: nothing was oversold. We
    //    translate it to the same answer as step 2. Anything else is re-thrown untouched (our own
    //    errors from step 2, or a real failure that becomes a 500).
    if (isSeatsLeftCheckViolation(err)) throw new ConflictError("Not enough seats left");
    throw err;
  }
}

// THE ALTERNATIVE we did not use: one conditional UPDATE, with no explicit lock.
//
//   UPDATE events SET seats_left = seats_left - $n
//   WHERE id = $1 AND seats_left >= $n AND starts_at > now()
//   RETURNING seats_left;                      -- then INSERT the booking, in the same transaction
//
// It is just as safe: an UPDATE locks the row it changes, a second UPDATE on the same row waits,
// and after the wait Postgres checks the WHERE again on the NEW row (seats_left >= $n is false once
// the seats are gone), so it updates 0 rows instead of overselling.
// + One statement instead of two, so one round trip less, and the row is locked for less time.
// - When it updates 0 rows, we do not know WHY: unknown event? already started? sold out? We need
//   a second query to give the right message (404 / 400 / 409), and that answer can already be
//   out of date. With the explicit lock, the row we checked is the row we change.
// - Every new rule (e.g. "at most 4 tickets per user per event") has to fit into one WHERE clause.
// Both put bookings for one event in a queue on its row; neither is faster under heavy contention.
// We chose the explicit lock because each step and each error is easy to see and to explain.

// The user's bookings, newest first, each with its event's title, venue and start time.
// ONE query with a JOIN, so Postgres matches each booking with its event.
// AVOIDS THE N+1 PROBLEM: the obvious alternative is 1 query for the bookings, then 1 query PER
// booking for its event (N more). 30 bookings = 31 round trips to the database, and the page gets
// slower with every ticket the user buys. The join is always 1 round trip.
// The index bookings_user_id_created_at_idx serves both the WHERE and the ORDER BY
// (see db/schema/bookings.ts); each event is found by its primary key.
export async function listByUser(userId: string) {
  return db
    .select({
      id: bookings.id,
      eventId: bookings.eventId,
      quantity: bookings.quantity,
      status: bookings.status,
      createdAt: bookings.createdAt,
      event: { title: events.title, venue: events.venue, startsAt: events.startsAt },
    })
    .from(bookings)
    .innerJoin(events, eq(bookings.eventId, events.id))
    .where(eq(bookings.userId, userId))
    .orderBy(desc(bookings.createdAt));
}

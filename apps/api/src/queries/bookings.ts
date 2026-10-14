import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import { bookings } from "../db/schema/bookings";
import { events } from "../db/schema/events";
import { BadRequestError, ConflictError, NotFoundError } from "../errors";

// THE PROBLEM IDEMPOTENCY KEYS SOLVE (step F2b)
// A booking succeeds on the server, but the response is lost on the way back (Wi-Fi drops, a proxy
// times out, the laptop sleeps). The browser only sees "network error", so it retries (on its own,
// see apps/web/src/features/bookings/lib/booking-retry.ts, or because the user clicks again).
// Without protection, the retry is a brand-new request: the user gets a SECOND booking and pays
// for seats twice, although they asked once.
//
//   browser                         API + Postgres
//   book 2 (key K) ---------------> booked #b1, seats -2, COMMIT
//            X<------------------- 200 #b1   (lost)
//   retry: book 2 (key K) -------> key K already has #b1: no new booking, seats untouched
//            <-------------------- 200 #b1   (the same answer as the first time)
//
// THE FIX: the browser makes ONE random key (a UUID) per booking intent and sends it with the
// request and with every retry of it. The bookings table stores it, unique per user, so "the same
// request again" is something Postgres can recognise. createBookingTx below books at most once per
// (user, key) and answers a repeat with the booking it made the first time. That is IDEMPOTENCY:
// doing it twice has the same effect as doing it once.

// Queries: the only code that talks to the database. No business logic here.
// ONE exception, on purpose: the three checks in createBookingTx (step 3). They must run INSIDE the
// transaction, while the event row is locked, and a service cannot hold a transaction (services
// never see SQL). Checked anywhere else, the answer could be out of date by the time we write.
// (Whether a repeated key is the SAME booking or a different one is decided in the service,
// services/bookings.ts: that comparison needs no lock, the stored booking never changes.)

// Postgres error codes and the constraint names we translate:
// - check_violation on the constraint that keeps seats_left >= 0 (apps/api/src/db/schema/events.ts);
// - unique_violation on one booking per (user, idempotency key) (apps/api/src/db/schema/bookings.ts).
const CHECK_VIOLATION = "23514";
const SEATS_LEFT_CHECK = "events_seats_left_not_negative";
const UNIQUE_VIOLATION = "23505";
const IDEMPOTENCY_KEY_UNIQUE = "bookings_user_id_idempotency_key_unique";

// Drizzle wraps driver errors and keeps the original in `.cause` (same as in ./users.ts), so the
// Postgres code and constraint name may be on the error or on its cause.
function isPgConstraintError(err: unknown, code: string, constraint: string): boolean {
  const pgError = (e: unknown) =>
    typeof e === "object" && e !== null && "code" in e ? (e as { code: unknown; constraint?: unknown }) : undefined;
  const found = pgError(err) ?? pgError((err as { cause?: unknown } | null)?.cause);
  return found?.code === code && found.constraint === constraint;
}

// One booking row, as Postgres stores it.
type BookingRow = typeof bookings.$inferSelect;

// What createBookingTx did:
// - "created":  a new booking, seats taken, committed. It also carries the event's title, venue and
//   start time, which the transaction had already read (step 1): the confirmation message needs
//   them (services/bookings.ts), and this saves a second query;
// - "existing": this user already has a booking with this key (made by an earlier copy of the same
//   request, or by a different request that reused the key). NOTHING was written this time.
//   The service compares it with the request: same event + quantity = a replay, else a 409.
export type CreateBookingResult =
  | { kind: "created"; booking: BookingRow; event: { title: string; venue: string; startsAt: Date } }
  | { kind: "existing"; booking: BookingRow };

// The booking this user made with this key, if any. Served by the unique index of the constraint
// above (user_id, idempotency_key): one index lookup. `executor` is the transaction when called
// inside one (so it reads under our lock), or the plain pool after a rollback.
async function findByKey(executor: Pick<typeof db, "select">, userId: string, idempotencyKey: string) {
  const [existing] = await executor
    .select()
    .from(bookings)
    .where(and(eq(bookings.userId, userId), eq(bookings.idempotencyKey, idempotencyKey)));
  return existing;
}

// Book `quantity` seats of one event for one user, in ONE transaction, at most ONCE per
// (user, idempotency key). Returns the new booking, or the one this key already has.
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
//
// WHY A DUPLICATE IS HARMLESS EVEN WHEN BOTH COPIES ARRIVE AT THE SAME MOMENT (same user, same key):
// - Same event (the normal case: a retry, a double click): the row lock in step 1 puts them in a
//   queue. A books and COMMITs; only then does B get the lock, and B's key lookup (step 2) already
//   sees A's committed booking (READ COMMITTED: each statement sees everything committed before it
//   started). B returns it and writes nothing.
// - Different events (a buggy or hostile client reusing a key): the two lock DIFFERENT rows, so
//   nothing queues them, and both can pass step 2. Then the UNIQUE (user_id, idempotency_key)
//   constraint decides: B's INSERT waits for A's unfinished insert of the same key, and when A
//   commits, B's INSERT fails with 23505. B's WHOLE transaction rolls back, including its
//   seats_left update, so no seats are taken twice. Step 6 then reads A's booking, and the service
//   answers 409 (different booking, same key).
// - If A fails and rolls back instead, the key is free again and B simply books.
// Postgres guarantees all three; no application lock, no Redis, no "check then insert" gap.
export async function createBookingTx(
  eventId: string,
  userId: string,
  quantity: number,
  idempotencyKey: string,
): Promise<CreateBookingResult> {
  try {
    const booking = await db.transaction(async (tx): Promise<CreateBookingResult> => {
      // 1. Read the event AND lock its row: SELECT ... FROM events WHERE id = $1 FOR UPDATE.
      //    WHAT THE LOCK DOES: from now until our COMMIT or ROLLBACK, no other transaction can lock,
      //    update or delete THIS row. It is a lock on one row only, not on the table.
      //    WHO WAITS: another booking for the SAME event reaches its own FOR UPDATE and stops there
      //    (it queues) until we finish. It then reads the row AGAIN, with our new seats_left
      //    (Postgres re-reads a locked row after the wait, even in the default isolation level,
      //    READ COMMITTED). Bookings for OTHER events never wait for us, and neither do plain
      //    reads like events.list: Postgres keeps the old version of the row for them (MVCC), so
      //    readers never wait for writers.
      //    WHY THIS PREVENTS OVERSELLING: the read below and the write in step 4 happen with nobody
      //    able to change the row in between. Bookings for one event run one after another, each
      //    one seeing the previous one's result, so the check in step 3 is never out of date.
      //    The COST: a hugely popular event becomes a queue on one row ("hot row"): every booking
      //    for it waits its turn, a few milliseconds each. Fine at our size; at a real ticket
      //    on-sale it is the bottleneck (then: split the seats over several rows, or queue requests).
      //    Each waiting booking also keeps one pool connection busy (the pool has 10, db/client.ts).
      const [event] = await tx
        .select({ title: events.title, venue: events.venue, startsAt: events.startsAt, seatsLeft: events.seatsLeft })
        .from(events)
        .where(eq(events.id, eventId))
        .for("update");

      // 2. Has this user already booked with this key? Then this request is a repeat: return that
      //    booking and write nothing (the transaction commits with no changes, the lock is released).
      //    WHY BEFORE THE CHECKS, and after the lock: if the first copy took the LAST seats, the
      //    checks below would now say "Not enough seats left" (or, a day later, "already started"),
      //    and the user would see an error for a booking they DO have. A repeat must get the first
      //    answer whatever happened since. After the lock, so a copy that waited in the queue sees
      //    the booking the copy before it just committed.
      const existing = await findByKey(tx, userId, idempotencyKey);
      if (existing) return { kind: "existing", booking: existing };

      // 3. The checks, on the LOCKED row, so their answer stays true until we commit.
      //    Throwing here rolls the transaction back (nothing was written yet) and releases the lock.
      //    "Already started" uses this server's clock. The order matters for the message: a
      //    sold-out event that has already started says "already started".
      if (!event) throw new NotFoundError("Event not found");
      if (event.startsAt.getTime() <= Date.now()) throw new BadRequestError("This event has already started");
      if (event.seatsLeft < quantity) throw new ConflictError("Not enough seats left");

      // 4. Take the seats. `seats_left - quantity` is computed BY POSTGRES from the row's current
      //    value, not from the number we read in step 1. With the lock, both are the same. But if a
      //    later change ever broke the lock, this form plus the CHECK constraint below still stops an
      //    oversell (seats_left would go below 0, and Postgres refuses that), while writing the number
      //    we computed ourselves would silently lose the other booking's update.
      await tx
        .update(events)
        .set({ seatsLeft: sql`${events.seatsLeft} - ${quantity}` })
        .where(eq(events.id, eventId));

      // 5. Save the booking WITH its key and return it (with its generated id and createdAt).
      //    It becomes visible to other connections only at COMMIT, together with the new seat count.
      //    If another transaction has (or is just inserting) a booking with this user + key, this
      //    INSERT fails with 23505 (see "WHY A DUPLICATE IS HARMLESS" above) and step 6 takes over.
      const [created] = await tx.insert(bookings).values({ eventId, userId, quantity, idempotencyKey }).returning();
      return { kind: "created", booking: created, event: { title: event.title, venue: event.venue, startsAt: event.startsAt } };
    });
    return booking;
  } catch (err) {
    // 6. A DUPLICATE KEY that slipped past step 2 (two copies at the same moment, for different
    //    events). Postgres has already rolled our transaction back: our seats_left update is undone,
    //    so the seats are NOT taken twice. Now read the booking the other copy committed, outside
    //    the (finished) transaction. The service decides: same request -> replay, else 409.
    if (isPgConstraintError(err, UNIQUE_VIOLATION, IDEMPOTENCY_KEY_UNIQUE)) {
      const existing = await findByKey(db, userId, idempotencyKey);
      // Can't really happen (bookings are never deleted); if it does, the original error is the truth.
      if (!existing) throw err;
      return { kind: "existing", booking: existing };
    }
    // 7. THE LAST SAFETY NET: the CHECK constraint events_seats_left_not_negative (seats_left >= 0).
    //    With the lock above it never fires. If it ever does (a bug, a script that skipped the lock),
    //    Postgres has refused the update and rolled the transaction back: nothing was oversold. We
    //    translate it to the same answer as step 3. Anything else is re-thrown untouched (our own
    //    errors from step 3, or a real failure that becomes a 500).
    if (isPgConstraintError(err, CHECK_VIOLATION, SEATS_LEFT_CHECK)) throw new ConflictError("Not enough seats left");
    throw err;
  }
}

// OTHER WAYS TO STORE IDEMPOTENCY KEYS (compared, not built)
//
// 1. Keys in Redis with a TTL: before booking, `SET idem:<user>:<key> <booking id> NX EX 86400`.
//    + Works for any endpoint, even one that writes no row (sending an email, calling another API).
//    + Old keys clean themselves up (the TTL), so the table does not keep them forever.
//    - Redis and Postgres are two systems with no shared transaction. Crash after the booking
//      commits but before Redis is updated (or the reverse) and the two disagree: a retry books
//      again, or a key points to a booking that was rolled back. Fixing that needs a "pending"
//      state, timeouts and clean-up: much more code than one UNIQUE constraint.
//    - A retry after the TTL is a new booking again; and if Redis loses data (eviction, restart:
//      our Redis is `allkeys-lru`), the protection silently disappears.
//    Our key lives IN the booking row, so it is committed or rolled back TOGETHER with the
//    booking and the seats. It can never disagree with them.
//
// 2. Payment APIs (e.g. Stripe's `Idempotency-Key` header): the server stores the key with the
//    FULL first response (status code + body) and the request's parameters, for about 24 hours.
//    A repeat gets that stored response back byte for byte, even a stored error; a repeat with
//    different parameters is refused; a repeat while the first is still running gets a
//    "request in progress" error. It is generic (one table for every endpoint) and exact.
//    We only replay SUCCESSES, and we rebuild the answer from the booking row instead of storing
//    it: a failed booking stored nothing (it rolled back), so retrying it with the same key simply
//    tries again. That is what we want here: "not enough seats" may be wrong a second later.
//    Our key also never expires: fine at our size (16 bytes per booking).

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

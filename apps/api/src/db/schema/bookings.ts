import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { events } from "./events";
import { users } from "./users";

// The statuses a booking can have. Only "confirmed" today; cancelled / waitlisted come later.
// Same list as BookingStatus in packages/shared and as the CHECK constraint below. Written here again
// because drizzle-kit reads this file on its own (same reason as ROLES in ./users.ts).
const STATUSES = ["confirmed"] as const;

// The `bookings` table: one row per "Book ticket" click that worked. One row can hold 1-4 tickets
// (quantity), so "how many tickets does this user have" is a SUM, not a COUNT.
export const bookings = pgTable(
  "bookings",
  {
    // 1. Primary key: a random UUID made by Postgres (same choice as `users` and `events`).
    id: uuid("id").primaryKey().defaultRandom(),
    // 2. Foreign keys: Postgres refuses a booking for an event or user that does not exist.
    //    No ON DELETE rule (the default is NO ACTION): deleting an event or a user that still has
    //    bookings fails, instead of silently deleting people's tickets.
    //    Postgres does NOT index a foreign key column by itself. user_id is covered by the index
    //    below (it is its first column); event_id has no index yet (nothing looks bookings up by
    //    event today; deleting an event would scan this table).
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    quantity: integer("quantity").notNull(),
    // 3. `enum` only tells TypeScript the allowed values; the CHECK below makes Postgres enforce them.
    status: text("status", { enum: STATUSES }).notNull().default("confirmed"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // 4. The idempotency key (step F2b): a random UUID the BROWSER makes once per booking intent and
    //    sends with every retry of it. Same key again = "the same booking I asked for before", so the
    //    API returns that booking instead of making a second one (queries/bookings.ts,
    //    createBookingTx). No default on purpose: every new booking must bring its own key (the
    //    migration gave the rows that existed before this step a random one).
    idempotencyKey: uuid("idempotency_key").notNull(),
  },
  (table) => [
    // 5. The database itself refuses bad data, even from a script or psql: 1 to 4 tickets per
    //    booking (the same limit as BookTicketInput), and only known statuses.
    check("bookings_quantity_1_to_4", sql`${table.quantity} between 1 and 4`),
    check("bookings_status_valid", sql`${table.status} in ('confirmed')`),
    // 6. The index for "My tickets": WHERE user_id = $1 ORDER BY created_at DESC.
    //    WHY these two columns, in this order: user_id first, because it is an equality, so Postgres
    //    jumps straight to this user's rows; created_at second, because inside one user the rows are
    //    then already sorted by time, so there is no sort step (Postgres reads the index backwards
    //    for DESC). Without it, Postgres would read EVERY booking of EVERY user to find one user's,
    //    and the cost would grow with the whole table instead of with that one user's bookings.
    index("bookings_user_id_created_at_idx").on(table.userId, table.createdAt),
    // 7. One booking per (user, key). The key is unique PER USER, not across the whole table: one
    //    user's key can never collide with (or reveal) another user's booking, and a user can only
    //    ever replay their OWN bookings. This constraint is what makes a duplicate request harmless
    //    even when two copies run at the same moment: the second INSERT fails (23505), its whole
    //    transaction rolls back (seats included), and createBookingTx returns the first booking.
    //    Postgres builds a unique index for it, so "find this user's booking for this key" is fast.
    unique("bookings_user_id_idempotency_key_unique").on(table.userId, table.idempotencyKey),
  ],
);

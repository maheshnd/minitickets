import { check, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// @concept: drizzle-schema
// The `events` table: one row per event people can book seats for.
// @concept: db-check-constraints
// @concept: indexing
// One extra index, on starts_at: it serves listUpcoming (see queries/events.ts). Added in Feature 1, step 3.
export const events = pgTable(
  "events",
  {
    // 1. Primary key: a random UUID made by Postgres (same choice as `users`).
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    venue: text("venue").notNull(),
    // 2. timestamptz: Postgres stores the moment in UTC. The browser shows it in the user's timezone.
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    totalSeats: integer("total_seats").notNull(),
    seatsLeft: integer("seats_left").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // 3. The database itself refuses bad data. Even a buggy service, a script or a person in psql
    //    cannot save an event with no seats, negative seats left, or more seats left than seats.
    check("events_total_seats_positive", sql`${table.totalSeats} > 0`),
    check("events_seats_left_not_negative", sql`${table.seatsLeft} >= 0`),
    check("events_seats_left_within_total", sql`${table.seatsLeft} <= ${table.totalSeats}`),
    // 4. A B-tree index on starts_at, the one column listUpcoming filters AND sorts on.
    //    Without it Postgres reads every row and sorts them; with it, it jumps to "now" and reads 50 rows.
    index("events_starts_at_idx").on(table.startsAt),
  ],
);

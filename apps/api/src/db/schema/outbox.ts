import type { BookingConfirmedMessage } from "@minitickets/shared";
import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { bookings } from "./bookings";

// @concept: outbox
// 1. One durable confirmation per booking. Its id is also the messageId on EVERY publish attempt,
//    so the worker can recognise redelivery after a relay crash (delivery is at least once).
export const outbox = pgTable("outbox", {
  id: uuid("id").primaryKey(),
  // The app has no booking deletion. Demo cleanup / stack:reset delete confirmations with their
  // bookings, so those existing tools still work after this migration.
  bookingId: uuid("booking_id").notNull().unique().references(() => bookings.id, { onDelete: "cascade" }),
  payload: jsonb("payload").$type<BookingConfirmedMessage>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // 2. Unsent rows stay here through queue outages. Only due rows are locked by the relay;
  //    successful rows remain as a delivery record (retention is a later operational choice).
  availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
  attempts: integer("attempts").notNull().default(0),
  sentAt: timestamp("sent_at", { withTimezone: true }),
}, (table) => [
  check("outbox_attempts_not_negative", sql`${table.attempts} >= 0`),
  index("outbox_pending_idx").on(table.availableAt, table.id).where(sql`${table.sentAt} is null`),
]);

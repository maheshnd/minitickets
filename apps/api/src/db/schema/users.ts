import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// @concept: drizzle-schema
// @concept: sql-vs-nosql
// The `users` table. Each property below becomes one column.
export const users = pgTable("users", {
  // 1. Primary key: a random UUID made by Postgres, so ids can't be guessed or counted.
  id: uuid("id").primaryKey().defaultRandom(),
  // @concept: indexing
  // @concept: unique-constraint-race
  // 2. Email must be present and unique (no two accounts share an email).
  email: text("email").notNull().unique(),
  // 3. We store a hash of the password, never the password itself.
  passwordHash: text("password_hash").notNull(),
  // 4. When the row was created. `withTimezone` makes it a timestamptz; the default is now().
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

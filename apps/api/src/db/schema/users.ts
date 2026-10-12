import { sql } from "drizzle-orm";
import { check, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// What a user may do. Same list as UserRole in packages/shared (the API's output schema) and as
// the CHECK constraint below (the database). It is written here again because drizzle-kit reads
// this file on its own and should not depend on the shared package.
const ROLES = ["user", "admin"] as const;

// @concept: drizzle-schema
// @concept: sql-vs-nosql
// The `users` table. Each property below becomes one column.
export const users = pgTable(
  "users",
  {
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
    // 5. The user's role (RBAC: role-based access control). Everyone starts as "user"; only the
    //    make-admin script (src/scripts/make-admin.ts) turns someone into an "admin".
    //    `enum` only tells TypeScript the allowed values; the CHECK below makes Postgres enforce them.
    role: text("role", { enum: ROLES }).notNull().default("user"),
  },
  (table) => [
    // 6. The database itself refuses any other role, e.g. a typo like "admn" from a script or psql.
    check("users_role_valid", sql`${table.role} in ('user', 'admin')`),
  ],
);

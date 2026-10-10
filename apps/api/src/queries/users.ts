import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { users } from "../db/schema/users";

// Queries: the only code that talks to the database. No business logic here.

// 1. Look up one user by email. Returns the user, or undefined if there is none.
export async function findByEmail(email: string) {
  const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return rows[0];
}

// 2. Insert a new user and return the saved row (with its generated id and createdAt).
export async function create(input: { email: string; passwordHash: string }) {
  const rows = await db.insert(users).values(input).returning();
  return rows[0];
}

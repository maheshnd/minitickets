import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { users } from "../db/schema/users";
import { ConflictError } from "../errors";

// Queries: the only code that talks to the database. No business logic here.

// Postgres error code for "unique_violation".
const UNIQUE_VIOLATION = "23505";

// Drizzle wraps driver errors (DrizzleQueryError) and keeps the original in `.cause`.
// So the Postgres code may be on the error itself or on its cause; check both.
function isUniqueViolation(err: unknown): boolean {
  const code = (e: unknown) => (typeof e === "object" && e !== null && "code" in e ? e.code : undefined);
  return code(err) === UNIQUE_VIOLATION || code((err as { cause?: unknown } | null)?.cause) === UNIQUE_VIOLATION;
}

// 1. Look up one user by email. Returns the user, or undefined if there is none.
export async function findByEmail(email: string) {
  const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return rows[0];
}

// 2. Insert a new user and return the saved row (with its generated id and createdAt).
export async function create(input: { email: string; passwordHash: string }) {
  try {
    const rows = await db.insert(users).values(input).returning();
    return rows[0];
  } catch (err) {
    // 3. This is the "translate" try/catch: we do not handle the error, we only rename it.
    //    Postgres speaks in driver codes (23505); the service layer must not know about
    //    them. So a duplicate email becomes our own ConflictError, and anything else
    //    is rethrown untouched (it is a real failure and ends up as a 500).
    if (isUniqueViolation(err)) throw new ConflictError("Email already registered");
    throw err;
  }
}

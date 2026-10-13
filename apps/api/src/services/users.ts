import { NotFoundError } from "../errors";
import * as users from "../queries/users";

// Services: business logic. No HTTP and no SQL in here.

// Make an existing user an admin. Used by the make-admin script (there is no UI for roles).
// The change counts from that user's very next ADMIN request: the API reads the role from
// Postgres on every admin request (getRole, used by trpc/init.ts), it keeps no copy in the session.
export async function makeAdmin(email: string) {
  // 1. One UPDATE. If no user has this email, nothing changed: say so clearly.
  const user = await users.setRoleByEmail(email, "admin");
  if (!user) throw new NotFoundError(`No user with email ${email}. Sign up first, then run this again.`);

  // 2. Only the safe fields.
  return { id: user.id, email: user.email, role: user.role };
}

// The user's current role, or null if the user no longer exists (the session outlived the account).
// Read from Postgres on every call, so a role change counts at once. Only adminProcedure calls this.
export async function getRole(userId: string) {
  const user = await users.findById(userId);
  return user ? user.role : null;
}

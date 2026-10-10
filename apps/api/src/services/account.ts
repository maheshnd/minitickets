import { NotFoundError } from "../errors";
import * as users from "../queries/users";

// Services: business logic. No HTTP and no SQL in here.

// Profile: the logged-in user's own details.
export async function getProfile(userId: string) {
  // 1. The session can outlive the user (e.g. the account was deleted), so the row may be gone.
  const user = await users.findById(userId);
  if (!user) throw new NotFoundError("User not found");

  // 2. Pick the safe fields by hand. createdAt becomes an ISO string, which is what
  //    the browser receives anyway (JSON has no Date type).
  return { id: user.id, email: user.email, createdAt: user.createdAt.toISOString() };
}

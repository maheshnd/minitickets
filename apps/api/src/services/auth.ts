import { hash, verify } from "@node-rs/argon2";
import { UnauthorizedError } from "../errors";
import * as sessions from "../queries/sessions";
import * as users from "../queries/users";

// Services: business logic. No HTTP and no SQL in here.

// How long the browser should keep the session cookie. Same as the Redis TTL, so the cookie
// and the stored session expire together. (Exported so procedures don't import from queries/.)
export const SESSION_MAX_AGE_SECONDS = sessions.SESSION_TTL_SECONDS;

// A real argon2id hash of a throwaway password, made once with the same settings as signup.
// It is only used by login() below; no account has this password.
const DUMMY_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$qxYlzaWeG+euDYv/sW6Ipg$mbBjM9jB7i0XWwoIZ7pr9A7PiaBUg0t4sGLIJFG8yOg";

// Signup: hash the password, save the user, return only the safe fields.
export async function signup(input: { email: string; password: string }) {
  // 1. Hash with argon2id (the library's default algorithm). It is slow and memory-hungry
  //    on purpose, so stealing the database does not make password guessing cheap.
  //    The result is one string that also contains the random salt and the settings.
  const passwordHash = await hash(input.password);

  // 2. Insert straight away. We do NOT first ask "does this email exist?".
  //    Check-then-insert has a race condition: two requests with the same email can both
  //    run the check, both see "not found", and both insert. The unique constraint on
  //    users.email is checked by Postgres atomically, so exactly one insert wins and the
  //    other fails, which queries/users.ts turns into a ConflictError.
  const user = await users.create({ email: input.email, passwordHash });

  // 3. Return only id and email. The hash stays inside the server.
  return { id: user.id, email: user.email };
}

// Login: check the password, start a session, return the user and the raw session id.
export async function login(input: { email: string; password: string }) {
  // 1. Find the user. This may be undefined (unknown email).
  const user = await users.findByEmail(input.email);

  // 2. ALWAYS run one argon2 verify. For an unknown email we verify against the dummy hash
  //    and throw the result away. Without this, "unknown email" would answer in a few
  //    milliseconds and "wrong password" in ~50 ms, and an attacker could measure the
  //    difference to find out which emails have accounts. Equal timing hides that.
  const passwordOk = await verify(user?.passwordHash ?? DUMMY_HASH, input.password);

  // 3. One message for both failures, so the answer itself doesn't reveal which emails exist.
  if (!user || !passwordOk) throw new UnauthorizedError("Invalid email or password");

  // 4. Start the session. The raw id goes to the browser as a cookie (procedures/auth.ts).
  const sessionId = await sessions.create(user.id);
  return { user: { id: user.id, email: user.email }, sessionId };
}

// Current user: turn the session id from the cookie into a user. Returns null if the
// cookie is missing, the session expired, or the user no longer exists.
export async function getCurrentUser(sessionId: string | undefined) {
  if (!sessionId) return null;
  const session = await sessions.get(sessionId);
  if (!session) return null;
  const user = await users.findById(session.userId);
  return user ? { id: user.id, email: user.email } : null;
}

// Logout: revoke the session on the server. Idempotent: no cookie, or a session that is
// already gone, is fine, so calling logout twice is safe.
export async function logout(sessionId: string | undefined) {
  if (!sessionId) return;
  await sessions.remove(sessionId);
}

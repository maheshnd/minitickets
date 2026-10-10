import { hash } from "@node-rs/argon2";
import * as users from "../queries/users";

// Services: business logic. No HTTP and no SQL in here.

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

import { createHash, randomBytes } from "node:crypto";
import { redis } from "../redis/client";

// Queries: the only code that talks to a data store (here: Redis). No business logic.

// Sessions last 7 days. Redis deletes the key by itself when the time is up.
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

// 1. Redis key for a session: the SHA-256 HASH of the session id, never the raw id.
//    Why: the raw id lives only in the user's cookie. If someone reads our Redis
//    (a leak, a backup, a debug dump), they only see hashes. A hash can't be turned back
//    into the id, so they can't build a cookie and log in as someone else.
//    SHA-256 is fine here (not argon2): the id is 32 random bytes, so there is nothing to guess.
function keyFor(sessionId: string) {
  return `session:${createHash("sha256").update(sessionId).digest("hex")}`;
}

// 2. Create a session for a user. Returns the raw id, which goes into the cookie.
export async function create(userId: string) {
  // 32 random bytes = 256 bits, from the operating system's secure random generator.
  // base64url makes it safe to put in a cookie.
  const sessionId = randomBytes(32).toString("base64url");
  const value = JSON.stringify({ userId, createdAt: new Date().toISOString() });
  // "EX" sets the time-to-live in seconds.
  await redis.set(keyFor(sessionId), value, "EX", SESSION_TTL_SECONDS);
  return sessionId;
}

// 3. Look up a session. Returns { userId, createdAt }, or null if it is unknown or expired.
export async function get(sessionId: string) {
  const value = await redis.get(keyFor(sessionId));
  if (value === null) return null;
  return JSON.parse(value) as { userId: string; createdAt: string };
}

// 4. Delete a session (used by logout in a later step).
export async function remove(sessionId: string) {
  await redis.del(keyFor(sessionId));
}

import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { redis } from "../redis/client";

// @concept: ttl
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
// @concept: sessions-vs-jwt
// @concept: sql-vs-nosql
// @concept: stateless-servers
const StoredSession = z.object({ userId: z.uuid(), createdAt: z.iso.datetime() });
const hashId = (id: string) => createHash("sha256").update(id).digest("hex");
const keyFor = (id: string) => `session:${hashId(id)}`;
const indexFor = (userId: string) => `user-sessions:${userId}`;

const CREATE = `
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
redis.call('ZADD', KEYS[2], ARGV[4], ARGV[3])
redis.call('EXPIRE', KEYS[2], ARGV[2])
-- Bound per-user revocation work and session storage: retain at most 20 active devices.
if redis.call('ZCARD', KEYS[2]) > 20 then
  local oldest = redis.call('ZRANGE', KEYS[2], 0, 0)[1]
  redis.call('DEL', 'session:' .. oldest); redis.call('ZREM', KEYS[2], oldest)
end
if ARGV[5] ~= '' then redis.call('DEL', ARGV[5]) end
return 1
`;
const REVOKE = `
for _, hash in ipairs(redis.call('ZRANGE', KEYS[1], 0, -1)) do redis.call('DEL', 'session:' .. hash) end
return redis.call('DEL', KEYS[1])
`;
// 1. New random id on every login, atomically invalidating the old cookie's record. The user
//    index is required on reads: if Redis evicts that index, sessions fail closed, never revive.
export async function create(userId: string, previousId?: string) {
  const sessionId = randomBytes(32).toString("base64url");
  await redis.eval(CREATE, 2, keyFor(sessionId), indexFor(userId),
    JSON.stringify({ userId, createdAt: new Date().toISOString() }), SESSION_TTL_SECONDS,
    hashId(sessionId), Date.now(), previousId ? keyFor(previousId) : "");
  return sessionId;
}
// 2. Legacy records without index membership require a fresh login after P10 deploy.
export async function get(sessionId: string) {
  const value = await redis.get(keyFor(sessionId));
  if (!value) return null;
  const parsed = StoredSession.safeParse(JSON.parse(value));
  if (!parsed.success) return null;
  return await redis.zscore(indexFor(parsed.data.userId), hashId(sessionId)) === null ? null : parsed.data;
}
export async function remove(sessionId: string) { await redis.del(keyFor(sessionId)); }
// 3. Membership removal is atomic with token deletion; a later login adds only its fresh id.
export async function revokeAll(userId: string) { await redis.eval(REVOKE, 1, indexFor(userId)); }

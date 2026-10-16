import { env } from "../config/env";
import { createHash } from "node:crypto";
import { z } from "zod";
import { redis } from "../redis/client";
import { redisOperation } from "./redis-operation";

// 1. TIME gives every API task the same clock. Refill and consume happen in one atomic script.
// @concept: rate-limiting
export const TAKE_TOKEN = `
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local capacity, interval = tonumber(ARGV[1]), tonumber(ARGV[2])
local old = redis.call('HMGET', KEYS[1], 'tokens', 'at')
local at = tonumber(old[2]) or now
now = math.max(now, at)
local tokens = math.min(capacity, (tonumber(old[1]) or capacity) + (now - at) / interval)
local allowed, retry = 0, 0
if tokens >= 1 then tokens = tokens - 1; allowed = 1
else retry = math.ceil((1 - tokens) * interval) end
redis.call('HSET', KEYS[1], 'tokens', tokens, 'at', now)
redis.call('PEXPIRE', KEYS[1], math.ceil(capacity * interval))
return {allowed, retry}
`;
const Result = z.tuple([z.union([z.literal(0), z.literal(1)]), z.number().int().nonnegative()]);

export function rateLimitKey(scope: "login" | "booking", identity: string) {
  // 2. No raw IP/user id in Redis key names or logs; policies have independent buckets.
  return `${env.SALE_REDIS_NAMESPACE}:rate:v1:${scope}:${createHash("sha256").update(identity).digest("hex")}`;
}
export async function takeToken(scope: "login" | "booking", identity: string, capacity: number, refillMs: number) {
  const result = await redisOperation(redis.eval(TAKE_TOKEN, 1, rateLimitKey(scope, identity), capacity, refillMs));
  const [allowed, retryMs] = Result.parse(result);
  return { allowed: allowed === 1, retryAfterSeconds: Math.max(1, Math.ceil(retryMs / 1000)) };
}

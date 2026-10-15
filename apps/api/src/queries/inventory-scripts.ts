// 1. These scripts share one Redis hash slot per event. Postgres still decides every booking.
//    Reservations are temporary advisory debits, not paid tickets or customer seat holds.
export const INITIALIZE = `
if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end
redis.call('DEL', KEYS[2])
redis.call('HSET', KEYS[1], 'available', ARGV[1], 'inflight', 0, 'revision', 0, 'generation', ARGV[2])
redis.call('PEXPIRE', KEYS[1], 3600000)
return 1
`;
export const RESERVE = `
if redis.call('EXISTS', KEYS[1]) == 0 then return -1 end
-- allkeys-lru may evict only the lease index. Rebuild the advisory pair instead of stranding debits.
if tonumber(redis.call('HGET', KEYS[1], 'inflight')) > 0 and redis.call('EXISTS', KEYS[2]) == 0 then
  redis.call('DEL', KEYS[1]); return -1
end
if redis.call('HEXISTS', KEYS[1], 'i:' .. ARGV[1]) == 1 then return 2 end
local quantity = tonumber(ARGV[3])
if tonumber(redis.call('HGET', KEYS[1], 'available')) < quantity then return 0 end
-- Atomic compare + DECRBY-equivalent on a hash field; no two requests can spend the same count.
redis.call('HINCRBY', KEYS[1], 'available', -quantity)
redis.call('HINCRBY', KEYS[1], 'inflight', quantity)
redis.call('HINCRBY', KEYS[1], 'revision', 1)
redis.call('HSET', KEYS[1], 'i:' .. ARGV[1], ARGV[2], 'q:' .. ARGV[2], quantity, 't:' .. ARGV[2], ARGV[1])
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
redis.call('ZADD', KEYS[2], now + 30000, ARGV[2])
redis.call('PEXPIRE', KEYS[1], 3600000)
redis.call('PEXPIRE', KEYS[2], 3600000)
return 1
`;
export const SETTLE = `
-- Only this attempt may settle its debit. Replays, expired leases and old generations do nothing.
if redis.call('HGET', KEYS[1], 'i:' .. ARGV[1]) ~= ARGV[2] then return 0 end
local quantity = tonumber(redis.call('HGET', KEYS[1], 'q:' .. ARGV[2]))
if not quantity then return 0 end
if ARGV[3] == 'refund' then redis.call('HINCRBY', KEYS[1], 'available', quantity) end
redis.call('HINCRBY', KEYS[1], 'inflight', -quantity)
redis.call('HINCRBY', KEYS[1], 'revision', 1)
redis.call('HDEL', KEYS[1], 'i:' .. ARGV[1], 'q:' .. ARGV[2], 't:' .. ARGV[2])
redis.call('ZREM', KEYS[2], ARGV[2])
return 1
`;
export const SNAPSHOT = `
if redis.call('EXISTS', KEYS[1]) == 0 then return {} end
if tonumber(redis.call('HGET', KEYS[1], 'inflight')) > 0 and redis.call('EXISTS', KEYS[2]) == 0 then
  redis.call('DEL', KEYS[1]); return {}
end
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
-- Bounded cleanup: never block Redis on an unbounded hot-event backlog.
for _, owner in ipairs(redis.call('ZRANGEBYSCORE', KEYS[2], '-inf', now, 'LIMIT', 0, 100)) do
  local quantity = tonumber(redis.call('HGET', KEYS[1], 'q:' .. owner))
  local intent = redis.call('HGET', KEYS[1], 't:' .. owner)
  if quantity then
    redis.call('HINCRBY', KEYS[1], 'inflight', -quantity)
    redis.call('HINCRBY', KEYS[1], 'revision', 1)
    if redis.call('HGET', KEYS[1], 'i:' .. intent) == owner then redis.call('HDEL', KEYS[1], 'i:' .. intent) end
    redis.call('HDEL', KEYS[1], 'q:' .. owner, 't:' .. owner)
  end
  redis.call('ZREM', KEYS[2], owner)
end
return redis.call('HMGET', KEYS[1], 'generation', 'revision', 'inflight')
`;
export const RECONCILE = `
-- Compare-and-set: a reservation/refund during the SQL read invalidates this snapshot.
if redis.call('HGET', KEYS[1], 'generation') ~= ARGV[1] or
   redis.call('HGET', KEYS[1], 'revision') ~= ARGV[2] then return 0 end
redis.call('HSET', KEYS[1], 'available', math.max(0, tonumber(ARGV[3]) - tonumber(ARGV[4])))
redis.call('HINCRBY', KEYS[1], 'revision', 1)
return 1
`;

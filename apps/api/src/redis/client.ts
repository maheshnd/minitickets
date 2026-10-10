import { Redis } from "ioredis";
import { env } from "../config/env";

// 1. One shared Redis client for the whole API (like the Postgres pool).
//    ioredis connects in the background and reconnects by itself if Redis goes away.
export const redis = new Redis(env.REDIS_URL, {
  // 2. Fail fast: when Redis is down, a command fails after at most 1 retry instead of
  //    waiting forever. Then a login gets a quick generic 500 and the API stays up.
  maxRetriesPerRequest: 1,
  // 3. Do not queue commands while disconnected, for the same reason: error right away.
  enableOfflineQueue: false,
});

// 4. ioredis emits "error" when the connection fails. Node crashes the process when an
//    "error" event has no listener, so we log it instead. The client keeps retrying
//    and the API recovers by itself when Redis returns.
redis.on("error", (err) => {
  console.error("Redis connection error:", err.message);
});

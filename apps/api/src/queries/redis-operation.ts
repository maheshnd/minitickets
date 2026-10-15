// 1. Bound advisory/cache work. A timed-out write can still reach Redis later, so callers
//    must tolerate unknown outcomes (reservation tokens make inventory settlement idempotent).
export async function redisOperation<T>(operation: Promise<T>, ms = 200): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Redis operation timed out")), ms);
    })]);
  } finally { clearTimeout(timer); }
}

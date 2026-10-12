// Single-flight: when the same slow work is asked for many times at once, do it ONCE and give
// every caller the same answer.
//
// Example: the events cache is empty and 100 requests arrive together. Without this, all 100 run
// the same Postgres query (a "cache stampede"). With it, the first request starts the query and
// the other 99 wait for that same query to finish.
//
// IN-PROCESS ONLY: the list of running work is an ordinary Map in this Node process's memory.
// Another API instance (another process, another server) has its own Map and cannot see ours,
// so with N instances there can still be N queries at once. The Redis lock in services/events.ts
// is what coordinates across instances.

// 1. Work that is running right now, by key. Each value is the promise every caller waits on.
const inFlight = new Map<string, Promise<unknown>>();

export function singleFlight<T>(key: string, work: () => Promise<T>): Promise<T> {
  // 2. Already running for this key? Then just wait for the SAME promise: no new work.
  const running = inFlight.get(key);
  if (running) return running as Promise<T>;

  // 3. Not running: start it and remember it, so callers arriving meanwhile join in.
  //    `finally` removes the entry when the work ends, on success AND on error:
  //    - success: the next caller (after this) must start fresh work, not reuse an old answer
  //      forever (keeping answers is the cache's job, with its TTL);
  //    - error: every caller waiting right now gets the same error, but the next caller tries
  //      again instead of getting a stuck failure.
  const promise = work().finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}

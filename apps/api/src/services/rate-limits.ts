import { RateLimitedError, UnavailableError } from "../errors";
import { takeToken } from "../queries/rate-limits";

// 1. A modest burst supports normal use; sustained traffic gets one fresh token per interval.
export const RATE_POLICIES = {
  login: { capacity: 20, refillMs: 3000 },
  booking: { capacity: 10, refillMs: 1000 },
} as const;
export async function enforceRateLimit(scope: keyof typeof RATE_POLICIES, identity: string) {
  const policy = RATE_POLICIES[scope];
  let result;
  try { result = await takeToken(scope, identity, policy.capacity, policy.refillMs); }
  catch {
    // 2. Fail closed for abuse protection. Do not run expensive password hashes/DB writes unbounded.
    throw new UnavailableError("Please try again shortly");
  }
  if (!result.allowed) throw new RateLimitedError(result.retryAfterSeconds);
}

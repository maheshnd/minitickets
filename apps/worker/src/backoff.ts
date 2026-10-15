// RETRY WITH BACKOFF: how long a FAILED message waits before its next try.
//
// Why wait at all? Most failures are temporary (the email service is overloaded or restarting).
// An immediate retry usually hits the same problem and fails again, and many workers retrying at
// once can keep a struggling service down. Waiting longer after each failure gives it time to
// recover: 10 s after the 1st failure, 40 s after the 2nd, 120 s after the 3rd (x4 each time, capped).
//
// The handler applies this with ChangeMessageVisibility (retry-later.ts), on Lambda and locally:
// the failed message stays hidden for this many seconds, then the queue offers it again. (SQS
// allows up to 12 hours.)
// Not built: JITTER (a random part added to each wait). When many messages fail at the same
// moment, jitter spreads their retries out so they do not all come back at the same second.

const FIRST_WAIT_SECONDS = 10;
const FACTOR = 4;
const MAX_WAIT_SECONDS = 120;

// receiveCount = how many times the queue has delivered this message so far (SQS's
// ApproximateReceiveCount): 1 on the first try, 2 on the second, ...
export function backoffSeconds(receiveCount: number): number {
  // 1. Anything odd (missing, 0, NaN) counts as the first try.
  const tries = Number.isFinite(receiveCount) && receiveCount >= 1 ? Math.floor(receiveCount) : 1;
  // 2. 10 * 4^(tries - 1) = 10, 40, 160, ... but never more than the cap.
  return Math.min(FIRST_WAIT_SECONDS * FACTOR ** (tries - 1), MAX_WAIT_SECONDS);
}

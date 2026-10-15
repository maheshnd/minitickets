import { BookingConfirmedMessage } from "@minitickets/shared";
import { setTimeout as sleep } from "node:timers/promises";
import * as outbox from "../queries/outbox";
import * as jobs from "../queues/jobs";

type Log = {
  info: (obj: object, msg: string) => void;
  warn: (obj: object, msg: string) => void;
  error: (obj: object, msg: string) => void;
};

// @concept: outbox
// 1. Retry indefinitely, from 1 second to 60 seconds; persisted due times survive API restarts.
//    The cap also bounds exponential arithmetic for a row that has failed for a long time.
export function retryInMs(attempts: number): number {
  return Math.min(60_000, 1000 * 2 ** Math.min(attempts, 6));
}

export async function relayOnce(log: Log): Promise<number> {
  // 2. Missing queue configuration pauses delivery, never discards a committed confirmation.
  if (!jobs.jobsEnabled) return 0;
  return outbox.deliverBatch(async (row) => {
    let correlationId: string | undefined;
    try {
      // 3. Treat stored JSON as input too. Keep both the original messageId and correlationId;
      //    logs use ids only (the payload contains the customer's email address).
      const message = BookingConfirmedMessage.parse(row.payload);
      correlationId = message.correlationId;
      if (message.messageId !== row.id || message.bookingId !== row.bookingId) throw new Error("outbox identity mismatch");
      await jobs.publishBookingConfirmed(message);
      log.info({ messageId: row.id, bookingId: row.bookingId, correlationId: message.correlationId }, "outbox message accepted by SNS");
      return { sent: true };
    } catch {
      // 4. Do not log the raw error: validation errors can quote personal data from the payload.
      const delay = retryInMs(row.attempts);
      log.warn({ messageId: row.id, bookingId: row.bookingId, correlationId, retryInMs: delay }, "outbox delivery failed; retry scheduled");
      return { sent: false, retryInMs: delay };
    }
  });
}

// 5. One sequential loop per API process (no overlapping interval callbacks). Drain full batches
//    immediately; sleep 1 second when idle. A database outage backs off too, up to 60 seconds.
export function startOutboxRelay(log: Log): () => Promise<void> {
  const controller = new AbortController();
  const done = (async () => {
    let failures = 0;
    while (!controller.signal.aborted && jobs.jobsEnabled) {
      let delay = 1000;
      try {
        const count = await relayOnce(log);
        failures = 0;
        if (count === 10) delay = 0;
      } catch {
        delay = retryInMs(failures++);
        log.error({ retryInMs: delay }, "outbox batch failed; transaction rolled back");
      }
      if (!controller.signal.aborted) {
        await sleep(delay, undefined, { signal: controller.signal }).catch(() => undefined);
      }
    }
  })();
  // 6. Wake an idle loop and wait for the current batch to COMMIT before closing the pool.
  return async () => { controller.abort(); await done; };
}

import { and, asc, eq, isNull, lte, sql } from "drizzle-orm";
import { db } from "../db/client";
import { outbox } from "../db/schema/outbox";

// @concept: outbox
export type PendingMessage = Pick<typeof outbox.$inferSelect, "id" | "bookingId" | "payload" | "attempts">;
export type DeliveryResult = { sent: true } | { sent: false; retryInMs: number };

// 1. Keep SQL and the transaction here. The service supplies ONLY the delivery callback, so it
//    never sees SQL/a transaction and this file never knows how to talk to SQS.
export async function deliverBatch(deliver: (row: PendingMessage) => Promise<DeliveryResult>): Promise<number> {
  return db.transaction(async (tx) => {
    // 2. Hold row locks through publish AND mark-sent. Other API tasks skip these rows instead
    //    of waiting or publishing them too. Ten rows cap each transaction at ten short SQS calls.
    const rows = await tx.select().from(outbox)
      .where(and(isNull(outbox.sentAt), lte(outbox.availableAt, sql`now()`)))
      .orderBy(asc(outbox.availableAt), asc(outbox.id)).limit(10)
      .for("update", { skipLocked: true });

    for (const row of rows) {
      const result = await deliver(row);
      // 3. Mark ONLY accepted messages. A failure schedules another attempt, in this same
      //    transaction. Database failure/crash rolls back these writes and releases the locks.
      await tx.update(outbox).set({
        attempts: row.attempts + 1,
        ...(result.sent
          ? { sentAt: sql`clock_timestamp()` }
          : { availableAt: sql`clock_timestamp() + ${result.retryInMs} * interval '1 millisecond'` }),
      }).where(eq(outbox.id, row.id));
    }
    // 4. Crash after SQS accepts but before COMMIT CAN republish a message. No database
    //    transaction can make SQS atomic; the persisted messageId + worker idempotency handle it.
    return rows.length;
  });
}

import type { SQSBatchItemFailure, SQSBatchResponse, SQSEvent } from "aws-lambda";
import { ZodError } from "zod";
import { correlationIdOf } from "./correlation";
import { handleBookingConfirmed, type Deps } from "./handlers/booking-confirmed";
import type { Log } from "./log";

// One batch of queue messages in, one answer out: WHICH messages failed.
//
// PARTIAL BATCH FAILURES. Lambda hands the worker up to 10 messages at once. If ONE of them fails
// and the whole call failed, all 10 would come back, and the 9 good ones would be handled again.
// Instead we return { batchItemFailures: [{ itemIdentifier: <messageId> }, ...] } listing only the
// failed ones: the queue deletes the rest and retries only those. This is Lambda's
// "ReportBatchItemFailures" format. On AWS it works ONLY if the event source mapping has
// FunctionResponseTypes = ["ReportBatchItemFailures"] (infra/src/jobs/queue-trigger.ts). Without that setting, Lambda
// ignores this answer and treats a normal return as "all done", deleting the failed ones too.
// The local runner (local.ts) honours the same answer.
export async function handleBatch(event: SQSEvent, deps: Deps, log: Log): Promise<SQSBatchResponse> {
  const batchItemFailures: SQSBatchItemFailure[] = [];

  // 1. One message after another. One failure must not stop the others, so each gets its own
  //    try/catch. (One at a time also means two copies of the same booking in one batch are
  //    handled in order: the second one finds the first one's record and is skipped.)
  for (const record of event.Records) {
    // 1b. This message's logger (P2): every line about it carries the api request's correlationId
    //     (correlation.ts), the queue's id for the message, and which try this is. So a search for
    //     the correlationId finds the api's lines AND these.
    const messageLog = log.child({
      correlationId: correlationIdOf(record.body),
      sqsMessageId: record.messageId,
      tries: record.attributes?.ApproximateReceiveCount,
    });
    try {
      // 2. The body is text. Parse it to a value; the handler validates its shape. Bad JSON throws.
      const result = await handleBookingConfirmed(JSON.parse(record.body), deps, messageLog);
      const what = result.status === "sent" ? "email sent" : "skipped, already done";
      messageLog.info(what, { jobKey: result.jobKey });
    } catch (err) {
      // 3. Any failure (bad JSON, wrong schema, mailer down, DynamoDB down) = this message failed.
      //    A bad message is a failure too: it will fail on every try, so after 3 tries the queue
      //    moves it to the dead-letter queue, where a person can look at it.
      //    An ERROR line (level 50): the alarms watch the DLQ, and Logs Insights finds these lines.
      messageLog.error("message failed", { error: describe(err) });
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  // 4. An empty list means "all succeeded".
  return { batchItemFailures };
}

// Short, safe text for a log line. We never print a message: it holds an email address.
function describe(err: unknown): string {
  // For a bad message, only the names of the wrong fields.
  if (err instanceof ZodError) return `invalid message, wrong fields: ${err.issues.map((i) => i.path.join(".")).join(", ")}`;
  // JSON.parse errors quote a piece of the body, so we do not print theirs.
  if (err instanceof SyntaxError) return "message body is not valid JSON";
  // The DynamoDB table is missing (a fresh DynamoDB Local container starts empty).
  if (err instanceof Error && err.name === "ResourceNotFoundException") return "processed-jobs table not found (locally: run `pnpm jobs:table`)";
  return err instanceof Error ? err.message : String(err);
}

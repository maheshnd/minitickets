import { BookingConfirmedMessage } from "@minitickets/shared";
import type { Log } from "../log";
import type { Mailer } from "../mailer";
import type { ProcessedJobs } from "../processed-jobs";

// The business logic of this job: turn a "booking confirmed" message into ONE email, even when
// the queue delivers the message more than once.
// Pure on purpose: no queue, no Lambda, no AWS. The mailer and the processed-jobs store come in as
// arguments, so a test can pass fakes and check exactly what would have happened.
//
// IDEMPOTENT CONSUMER. Queues deliver AT LEAST ONCE: a message can arrive twice (a worker crashed
// before deleting it, its visibility timeout ran out, the producer published it twice). So the
// handler first asks "is this job already done?" and skips it if so. Handling a duplicate then
// does no harm: the same result as handling it once.
//
// WHY THIS IS "EFFECTIVELY ONCE", NOT "EXACTLY ONCE" (honest version):
// - We send the email FIRST and record "done" SECOND. If the process crashes between the two
//   (or the record fails), the message comes back, the store says "not done", and the email is
//   sent AGAIN. Recording first would be worse: a crash after recording loses the email forever.
//   For an email, a rare duplicate is better than a lost one. That is at-least-once.
// - Two workers holding two copies at the SAME moment can both see "not done" and both send.
//   The conditional put lets only one of them record; the other just finds it already recorded.
// - Exactly-once DELIVERY doesn't really exist between two systems (the queue and the mail server
//   can't commit together). What we get is "effectively once": once in all the common cases,
//   twice only in the rare crash/race windows above.
// - A stronger option (NOT built): a LEASE. Before sending, write the job as "in progress until
//   now + 60 s" with a conditional write; a second worker that sees a live lease backs off; when
//   done, flip it to "done". That closes the two-workers window, but not the crash window (after a
//   crash the lease runs out and the email may go out again), and it costs one more write per job.
export type Deps = { mailer: Mailer; processedJobs: ProcessedJobs };

export type HandleResult = { status: "sent" | "skipped-duplicate"; jobKey: string };

// `log`: the logger of THIS message (batch.ts makes it, with its correlationId). The handler itself
// does not log; it only hands the logger to the mailer, so the mailer's line belongs to the booking.
// @concept: idempotency
export async function handleBookingConfirmed(rawMessage: unknown, deps: Deps, log: Log): Promise<HandleResult> {
  // 1. Validate with the shared schema. The queue holds text that anything could have put there,
  //    and it may be an older or newer version. A message that does not match throws (ZodError),
  //    and nothing is sent. The caller (batch.ts) reports it as failed, so after 3 tries the queue
  //    moves it to the dead-letter queue.
  const message = BookingConfirmedMessage.parse(rawMessage);

  // 2. The job's identity: the BUSINESS key (what the job is about), not the messageId (which
  //    envelope it came in). The same booking could be published twice with two different
  //    messageIds (for example by the outbox relay later, which may publish a row again after a
  //    crash). Keyed by messageId, both copies would look new and the customer would get 2 emails.
  //    Keyed by booking, the second copy is recognised: one booking = one confirmation email.
  const jobKey = `booking.confirmed:${message.bookingId}`;

  // 3. Already done? Then this is a duplicate: skip it, and report SUCCESS so the queue deletes it.
  //    (Reporting a failure would only make it come back again, and again, until the DLQ.)
  if (await deps.processedJobs.isDone(jobKey)) {
    return { status: "skipped-duplicate", jobKey };
  }

  // 4. Build the email from the message alone. Everything it needs is IN the message (see
  //    packages/shared/src/schemas/jobs.ts): the worker never reads the database.
  const startsAt = new Date(message.eventStartsAt).toUTCString();
  const tickets = message.quantity === 1 ? "1 ticket" : `${message.quantity} tickets`;
  const subject = `Your booking is confirmed: ${message.eventTitle}`;
  const body = [
    `Hi,`,
    ``,
    `You booked ${tickets} for ${message.eventTitle}.`,
    ``,
    `Where: ${message.eventVenue}`,
    `When: ${startsAt}`,
    `Tickets: ${message.quantity}`,
    ``,
    `See you there!`,
  ].join("\n");

  // 5. Send it. If this throws, so do we, and nothing is recorded: the message comes back and is
  //    tried again later (with backoff, see local.ts).
  await deps.mailer.send({ to: message.userEmail, subject, body }, log);

  // 6. Record "done" with a CONDITIONAL put (processed-jobs.ts). "already-recorded" means another
  //    worker finished the same job a moment ago (the two-workers window above). The email is sent
  //    either way, so it is still a success for this message, not an error.
  await deps.processedJobs.markDone(jobKey);
  return { status: "sent", jobKey };
}

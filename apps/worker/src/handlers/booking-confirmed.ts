import { BookingConfirmedMessage } from "@minitickets/shared";
import type { Mailer } from "../mailer";

// The business logic of this job: turn a "booking confirmed" message into an email.
// Pure on purpose: no queue, no Lambda, no AWS. The mailer comes in as an argument, so a test
// can pass a fake and check exactly what would have been sent.
export type Deps = { mailer: Mailer };

export async function handleBookingConfirmed(rawMessage: unknown, deps: Deps): Promise<void> {
  // 1. Validate with the shared schema. The queue holds text that anything could have put there,
  //    and it may be an older or newer version. A message that does not match throws (ZodError),
  //    and nothing is sent. The caller (lambda.ts) lets that failure leave the message in the queue.
  const message = BookingConfirmedMessage.parse(rawMessage);

  // 2. Build the email from the message alone. Everything it needs is IN the message (see
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

  // 3. Send it. If this throws, so do we: the message must NOT be deleted, so it comes back.
  await deps.mailer.send({ to: message.userEmail, subject, body });
}

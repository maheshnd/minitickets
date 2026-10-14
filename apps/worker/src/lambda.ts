import type { SQSEvent } from "aws-lambda";
import { handleBookingConfirmed } from "./handlers/booking-confirmed";
import { LogMailer } from "./mailer";

// The Lambda-shaped entry point: a function that receives an SQSEvent (a batch of queue messages)
// and returns when they are all handled. This is the function AWS Lambda will call when the
// worker is deployed (step S1c). Locally, local.ts calls it too: ONE code path in both places.
// The mailer is built here, so S1c swaps LogMailer for the SES mailer in one line.
const deps = { mailer: new LogMailer() };

export async function handler(event: SQSEvent): Promise<void> {
  // 1. Handle the records one after another. If one throws, the whole call fails: the caller
  //    (Lambda, or local.ts) then keeps the failed message in the queue to be delivered again.
  //    Handling the others first is safe because delivery is "at least once" anyway.
  for (const record of event.Records) {
    // 2. The body is text. Parse it to a value; the handler validates its shape. Bad JSON throws.
    await handleBookingConfirmed(JSON.parse(record.body), deps);
  }
}

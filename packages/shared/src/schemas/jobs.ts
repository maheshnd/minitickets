import { z } from "zod";

// The messages that go through the jobs queue (step S1a). The API (producer) builds them, the
// worker (consumer) validates them with the SAME schema, so both sides agree on the shape.
//
// WHY THESE THREE CHOICES:
// (a) VERSIONED: `type` + `version` are in every message. A message can sit in the queue while a
//     new API version is deployed, so the consumer may receive an old shape. With a version, a
//     change becomes a new schema (version 2) next to this one, and the consumer can handle both
//     during the switch. Without it, a producer and a consumer deployed at different moments break.
// (b) EVENT-CARRIED STATE TRANSFER: the message carries everything the email needs (who, what,
//     where, when). The worker never reads the database. So the worker has no database
//     credentials and no network path to Postgres, and on AWS the Lambda can live outside the VPC.
//     The price: the data is a snapshot from booking time (if the event's venue changes a minute
//     later, the email still says the old venue).
// (c) PERSONAL DATA: userEmail is personal data. Keep messages minimal (only what the email needs),
//     and NEVER log a whole message: logs live longer and reach more people than a queue does.
//     Log ids (messageId, bookingId) instead.
export const BookingConfirmedMessage = z.object({
  type: z.literal("booking.confirmed"),
  version: z.literal(1),
  // Unique per message: lets the consumer recognise a duplicate (queues deliver at least once).
  messageId: z.uuid(),
  bookingId: z.uuid(),
  userEmail: z.email(),
  eventTitle: z.string(),
  eventVenue: z.string(),
  // ISO 8601 text in UTC, like every date the API sends.
  eventStartsAt: z.string(),
  quantity: z.number().int().positive(),
  occurredAt: z.string(),
});

export type BookingConfirmedMessage = z.infer<typeof BookingConfirmedMessage>;

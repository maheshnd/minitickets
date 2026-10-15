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
// @concept: correlation-ids
// The CORRELATION ID (series 2, P2): one id per api request, written on EVERY log line that request
// causes, in every service. The api makes it (apps/api/src/http/correlation-id.ts), puts it in the
// messages it sends, and the worker writes it on its own log lines (apps/worker/src/correlation.ts).
// So one search for the id finds the whole story of one booking: api request -> queue -> email.
// A UUID, and nothing else: the api accepts an id from the caller's header, and a strict format
// keeps a caller from writing arbitrary text into our logs.
export const CorrelationId = z.uuid();

export const BookingConfirmedMessage = z.object({
  type: z.literal("booking.confirmed"),
  version: z.literal(1),
  // Unique per message: lets the consumer recognise a duplicate (queues deliver at least once).
  messageId: z.uuid(),
  bookingId: z.uuid(),
  // P4: optional for old email messages; the ticket consumer requires these two ids.
  eventId: z.uuid().optional(),
  userId: z.uuid().optional(),
  userEmail: z.email(),
  eventTitle: z.string(),
  eventVenue: z.string(),
  // ISO 8601 text in UTC, like every date the API sends.
  eventStartsAt: z.string(),
  quantity: z.number().int().positive(),
  occurredAt: z.string(),
  // The api request that booked (P2). OPTIONAL so this stays version 1: an older message without it
  // (sent before P2, still waiting in the queue) is still valid, and an older worker simply ignores
  // the extra field (z.object drops unknown keys). Adding an optional field is backward compatible;
  // renaming or removing one would need version 2 (see (a) above).
  correlationId: CorrelationId.optional(),
});

export type BookingConfirmedMessage = z.infer<typeof BookingConfirmedMessage>;

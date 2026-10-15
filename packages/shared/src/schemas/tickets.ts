import { z } from "zod";
import { MAX_TICKETS_PER_BOOKING } from "./bookings";
import { BookingConfirmedMessage } from "./jobs";

// 1. Email can read pre-P4 messages. Tickets need ownership and a valid event date;
//    legacy messages fail into the ticket DLQ rather than inventing missing facts.
export const TicketBookingMessage = BookingConfirmedMessage.extend({
  eventId: z.uuid(),
  userId: z.uuid(),
  eventStartsAt: z.iso.datetime(),
  occurredAt: z.iso.datetime(),
  quantity: z.number().int().min(1).max(MAX_TICKETS_PER_BOOKING),
});
export type TicketBookingMessage = z.infer<typeof TicketBookingMessage>;

// 2. Sign identity only, never an email address or an S3 URL. Version the claims so a
//    later scanner can refuse unknown formats instead of guessing their meaning.
export const TicketClaims = z.object({
  version: z.literal(1),
  ticketId: z.string().regex(/^[0-9a-f-]{36}:[1-4]$/),
  bookingId: z.uuid(),
  eventId: z.uuid(),
  userId: z.uuid(),
  seat: z.number().int().min(1).max(MAX_TICKETS_PER_BOOKING),
  eventStartsAt: z.iso.datetime(),
});
export type TicketClaims = z.infer<typeof TicketClaims>;

// 3. Reserve before S3; mark ready only AFTER the PNG exists. The stored token makes
//    concurrent retries agree even if a secret changes between calls.
export const TicketRecord = TicketClaims.extend({
  eventDate: z.iso.date(),
  eventDateKey: z.string().min(1),
  objectKey: z.string().regex(/^tickets\/[0-9a-f-]{36}\/[1-4]\.png$/),
  qrToken: z.string().min(1),
  status: z.enum(["creating", "ready"]),
  createdAt: z.iso.datetime(),
});
export type TicketRecord = z.infer<typeof TicketRecord>;

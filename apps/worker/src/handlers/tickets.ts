import { TicketBookingMessage, TicketRecord } from "@minitickets/shared";
import { signTicket } from "../tickets/token";
import type { TicketsStore } from "../tickets/store";

export type TicketDeps = {
  tickets: TicketsStore;
  secret: () => Promise<string>;
  writePng: (key: string, token: string) => Promise<void>;
};

export async function handleTickets(input: unknown, deps: TicketDeps): Promise<{ created: number; skipped: number }> {
  // 1. Stable ids are derived from the booking, NEVER the queue/message id. Publishing the
  //    same booking again therefore cannot mint more seats. Bound quantity before doing work.
  const message = TicketBookingMessage.parse(input);
  const secret = await deps.secret();
  let created = 0;
  let skipped = 0;
  for (let seat = 1; seat <= message.quantity; seat++) {
    const ticketId = `${message.bookingId}:${seat}`;
    const claims = { version: 1 as const, ticketId, bookingId: message.bookingId, userId: message.userId,
      eventId: message.eventId, seat, eventStartsAt: message.eventStartsAt };
    const ticket = TicketRecord.parse({ ...claims, eventDate: message.eventStartsAt.slice(0, 10),
      eventDateKey: `${message.eventStartsAt}#${ticketId}`, objectKey: `tickets/${message.bookingId}/${seat}.png`,
      qrToken: signTicket(claims, secret), status: "creating", createdAt: message.occurredAt });
    const stored = await deps.tickets.reserve(ticket);
    if (stored.status === "ready") { skipped++; continue; }
    // 2. A crash at either boundary is safe: resume a creating reservation, overwrite the same
    //    PNG, then mark ready. Ready tickets skip S3; partial bookings finish seat by seat.
    await deps.writePng(stored.objectKey, stored.qrToken);
    await deps.tickets.markReady(stored);
    created++;
  }
  return { created, skipped };
}

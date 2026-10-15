import type { TicketBooking } from "@minitickets/shared";
import * as bookings from "../queries/bookings";
import * as tickets from "../queries/tickets";
import { ASSET_URL_SECONDS, signAssetGet } from "../queries/assets";

export async function mine(userId: string): Promise<TicketBooking[]> {
  // 1. Postgres is the booking truth. DynamoDB may not have its asynchronous ticket records
  //    yet, so return every booking, even with zero QR codes. Never expose raw record fields.
  const [rows, issued] = await Promise.all([bookings.listByUser(userId), tickets.listByUser(userId)]);
  return Promise.all(rows.map(async booking => {
    const ready = issued.filter(ticket => ticket.bookingId === booking.id && ticket.status === "ready");
    const seen = new Set<number>();
    const publicTickets = await Promise.all(ready.map(async ticket => {
      // 2. Stored data is input too: do not sign an unrelated key, foreign owner or extra seat.
      if (ticket.userId !== userId || ticket.eventId !== booking.eventId || ticket.seat > booking.quantity
        || ticket.ticketId !== `${booking.id}:${ticket.seat}` || seen.has(ticket.seat)
        || ticket.objectKey !== `tickets/${booking.id}/${ticket.seat}.png`) throw new Error("invalid ticket ownership or key");
      seen.add(ticket.seat);
      const expiresAt = new Date(Date.now() + ASSET_URL_SECONDS * 1000).toISOString();
      const [qrUrl, downloadUrl] = await Promise.all([signAssetGet(ticket.objectKey),
        signAssetGet(ticket.objectKey, `ticket-${booking.id}-${ticket.seat}.png`)]);
      return { ticketId: ticket.ticketId, seat: ticket.seat, qrUrl, downloadUrl, expiresAt };
    }));
    return { id: booking.id, eventId: booking.eventId, quantity: booking.quantity, status: booking.status,
      createdAt: booking.createdAt.toISOString(), event: { ...booking.event, startsAt: booking.event.startsAt.toISOString() },
      creationStatus: publicTickets.length === booking.quantity ? "ready" as const : "creating" as const,
      tickets: publicTickets.sort((a, b) => a.seat - b.seat) };
  }));
}

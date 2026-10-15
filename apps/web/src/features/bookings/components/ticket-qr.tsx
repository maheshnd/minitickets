"use client";

import { useState } from "react";
import type { TicketBooking } from "@minitickets/shared";

export function TicketQr({ ticket, refresh }: { ticket: TicketBooking["tickets"][number]; refresh: () => void }) {
  // 1. Expired or temporarily unavailable images get an explicit refresh, avoiding an endless
  //    onError/refetch loop. Track the failed URL so a renewed link automatically renders again.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  return (
    <div className="rounded-md border border-gray-200 p-3">
      <p className="text-sm font-medium">Ticket {ticket.seat}</p>
      {failedUrl === ticket.qrUrl ? (
        <p className="my-3 text-sm text-gray-600">QR unavailable. Refresh your ticket links.</p>
      ) : (
        // 2. Signed private URLs must bypass the shared Next image optimizer/cache.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={ticket.qrUrl} alt={`QR code for ticket ${ticket.seat}`} width={240} height={240}
          className="my-2 h-auto w-60 max-w-full" referrerPolicy="no-referrer" onError={() => setFailedUrl(ticket.qrUrl)} />
      )}
      <a href={ticket.downloadUrl} download referrerPolicy="no-referrer" className="text-sm font-medium text-indigo-700 underline">
        Download ticket {ticket.seat}
      </a>
      {failedUrl === ticket.qrUrl && <button type="button" onClick={refresh} className="ml-3 text-sm text-indigo-700 underline">Refresh links</button>}
    </div>
  );
}

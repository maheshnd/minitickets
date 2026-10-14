"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
// The date must render the same on the server and during hydration, then switch to the viewer's
// timezone; the events feature already solved that, so we reuse its component.
import { EventDate } from "@/features/events/components/event-date";
import { useMyTickets } from "../hooks/use-my-tickets";

// The logged-in user's bookings, newest first. A Client Component because it uses a query.
export function MyTicketsList() {
  const tickets = useMyTickets();

  // 1. Loading. (On a 401 the hook is already redirecting to login, so we show the same text.)
  if (tickets.isPending || tickets.error?.data?.httpStatus === 401) {
    return <p className="text-gray-600">Loading your tickets...</p>;
  }

  // 2. Any other failure: a general message, never raw internals, and a way to try again.
  if (tickets.isError) {
    return (
      <div role="alert" className="space-y-3">
        <p className="text-red-700">Something went wrong. Please try again.</p>
        <Button variant="secondary" onClick={() => tickets.refetch()} disabled={tickets.isFetching}>
          Retry
        </Button>
      </div>
    );
  }

  // 3. No bookings yet: say so, and show the way to the events.
  if (tickets.data.length === 0) {
    return (
      <p className="text-gray-600">
        You have no tickets yet.{" "}
        <Link href="/events" className="font-medium text-indigo-700 underline">
          See upcoming events
        </Link>
      </p>
    );
  }

  // 4. One card per booking: the event (linked to its page), when and where, and how many tickets.
  return (
    <ul className="space-y-4">
      {tickets.data.map((ticket) => (
        <li key={ticket.id} className="rounded-lg border border-gray-200 bg-white p-5">
          <h2 className="text-lg font-semibold">
            <Link href={`/events/${ticket.eventId}`} className="hover:text-indigo-700 hover:underline">
              {ticket.event.title}
            </Link>
          </h2>
          <p className="mt-1 text-sm text-gray-700">
            <EventDate iso={ticket.event.startsAt} />
          </p>
          <p className="text-sm text-gray-600">{ticket.event.venue}</p>
          <p className="mt-3 text-sm font-medium">
            {ticket.quantity} {ticket.quantity === 1 ? "ticket" : "tickets"} · {ticket.status}
          </p>
        </li>
      ))}
    </ul>
  );
}

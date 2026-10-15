import type { Event } from "@minitickets/shared";
import Link from "next/link";
import { EventDate } from "./event-date";

// One event: title, when, where, and how many seats are left.
// The title links to the event's own page (/events/<id>), where tickets are booked.
// The date is its own small component (EventDate), because it must render the same text on the
// server and in the browser during hydration, then switch to the viewer's timezone.
export function EventCard({ event, position }: { event: Event; position?: { top: number; index: number; total: number } }) {
  const soldOut = event.seatsLeft === 0;

  return (
    <li className="rounded-lg border border-gray-200 bg-white p-5"
      aria-posinset={position ? position.index + 1 : undefined} aria-setsize={position?.total}
      style={position ? { position: "absolute", top: position.top, height: 192, width: "100%", overflow: "auto" } : undefined}>
      <div className="flex items-start justify-between gap-3">
        <h2 className="line-clamp-2 text-lg font-semibold">
          <Link href={`/events/${event.id}`} className="hover:text-indigo-700 hover:underline">
            {event.title}
          </Link>
        </h2>
        {soldOut && (
          <span className="shrink-0 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-800">
            Sold out
          </span>
        )}
      </div>
      <p className="mt-1 text-sm text-gray-700">
        <EventDate iso={event.startsAt} />
      </p>
      <p className="text-sm text-gray-600">{event.venue}</p>
      <p className="mt-3 text-sm text-gray-600">
        {soldOut ? "No seats left" : `${event.seatsLeft} of ${event.totalSeats} seats left`}
      </p>
    </li>
  );
}

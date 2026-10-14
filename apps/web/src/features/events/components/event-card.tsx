import type { Event } from "@minitickets/shared";
import Link from "next/link";
import { EventDate } from "./event-date";

// One event: title, when, where, and how many seats are left.
// The title links to the event's own page (/events/<id>), where tickets are booked.
// The date is its own small component (EventDate), because it must render the same text on the
// server and in the browser during hydration, then switch to the viewer's timezone.
export function EventCard({ event }: { event: Event }) {
  const soldOut = event.seatsLeft === 0;

  return (
    <li className="rounded-lg border border-gray-200 bg-white p-5">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-lg font-semibold">
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

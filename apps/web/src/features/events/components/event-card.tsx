import type { Event } from "@minitickets/shared";

// @concept: csr-vs-ssr
// The database stores startsAt in UTC. Intl.DateTimeFormat (no timezone given) shows it in the
// viewer's own timezone and language, so the same event reads differently in Paris and Tokyo.
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "full", timeStyle: "short" });

// One event: title, when, where, and how many seats are left.
export function EventCard({ event }: { event: Event }) {
  const soldOut = event.seatsLeft === 0;

  return (
    <li className="rounded-lg border border-gray-200 bg-white p-5">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-lg font-semibold">{event.title}</h2>
        {soldOut && (
          <span className="shrink-0 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-800">
            Sold out
          </span>
        )}
      </div>
      <p className="mt-1 text-sm text-gray-700">{dateFormat.format(new Date(event.startsAt))}</p>
      <p className="text-sm text-gray-600">{event.venue}</p>
      <p className="mt-3 text-sm text-gray-600">
        {soldOut ? "No seats left" : `${event.seatsLeft} of ${event.totalSeats} seats left`}
      </p>
    </li>
  );
}

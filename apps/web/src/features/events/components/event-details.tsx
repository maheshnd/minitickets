"use client";

import { useEvent } from "../hooks/use-event";
import { EventDate } from "./event-date";
import { PosterUpload } from "./poster-upload";

// The top of the event page: title, when, where, and how many seats are left.
// A Client Component because it reads the event through a query: the server's data arrives with the
// HTML (hydration), and after a booking the query is invalidated, so "seats left" updates in place.
export function EventDetails({ id }: { id: string }) {
  const event = useEvent(id);

  // 1. The page only renders us when the server HAS the event, so the data is in the cache from the
  //    first render. These two cases only happen if a later refetch fails or is still running.
  if (event.isPending) return <p className="text-gray-600">Loading...</p>;
  if (event.isError) {
    return (
      <p role="alert" className="text-red-700">
        Something went wrong. Please try again.
      </p>
    );
  }

  const { title, venue, startsAt, seatsLeft, totalSeats, posterUrl } = event.data;
  const soldOut = seatsLeft === 0;

  return (
    <section aria-labelledby="event-title" className="rounded-lg border border-gray-200 bg-white p-6">
      {/* 3. Private signed images bypass the shared image optimizer; the API renews on reads. */}
      {posterUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={posterUrl} alt={`Poster for ${title}`} className="mb-5 max-h-96 w-full rounded-md object-contain"
          referrerPolicy="no-referrer" />
      )}
      <div className="flex items-start justify-between gap-3">
        <h1 id="event-title" className="text-2xl font-bold">
          {title}
        </h1>
        {soldOut && (
          <span className="shrink-0 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-800">
            Sold out
          </span>
        )}
      </div>
      <p className="mt-2 text-sm text-gray-700">
        <EventDate iso={startsAt} />
      </p>
      <p className="text-sm text-gray-600">{venue}</p>
      {/* 2. Same text as the event card on /events, so both pages say it the same way. */}
      <p className="mt-3 text-sm text-gray-600">
        {soldOut ? "No seats left" : `${seatsLeft} of ${totalSeats} seats left`}
      </p>
      <PosterUpload eventId={id} />
    </section>
  );
}

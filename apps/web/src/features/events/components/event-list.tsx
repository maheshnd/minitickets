"use client";

import { Button } from "@/components/ui/button";
import { useEvents } from "../hooks/use-events";
import { EventCard } from "./event-card";
import { EventListSkeleton } from "./event-list-skeleton";

// The events page content. A Client Component because it uses a query.
// When the server already fetched the events (app/events/page.tsx), the data is in the cache from
// the first render, so it goes straight to step 4, on the server AND in the browser.
export function EventList() {
  const events = useEvents();

  // 1. Loading: only when the browser has to fetch by itself (the server could not).
  if (events.isPending) {
    return <EventListSkeleton />;
  }

  // @concept: ui-error-handling
  // 2. Failure: a general message (never raw internals) and a way to try again.
  if (events.isError) {
    return (
      <div role="alert" className="space-y-3">
        <p className="text-red-700">Something went wrong. Please try again.</p>
        <Button variant="secondary" onClick={() => events.refetch()} disabled={events.isFetching}>
          Retry
        </Button>
      </div>
    );
  }

  // 3. Success, but nothing to show.
  if (events.data.length === 0) {
    return <p className="text-gray-600">No upcoming events</p>;
  }

  // 4. Success: one card per event.
  return (
    <ul className="space-y-4">
      {events.data.map((event) => (
        <EventCard key={event.id} event={event} />
      ))}
    </ul>
  );
}

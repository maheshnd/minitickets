"use client";

import { Button } from "@/components/ui/button";
import { useEvents } from "../hooks/use-events";
import { EventCard } from "./event-card";

// The events page content. A Client Component because it uses a query.
export function EventList() {
  const events = useEvents();

  // 1. Loading: grey placeholder cards, so the page does not jump when the real ones arrive.
  if (events.isPending) {
    return (
      <ul aria-label="Loading events" aria-busy="true" className="space-y-4">
        {[0, 1, 2].map((i) => (
          <li key={i} className="h-28 animate-pulse rounded-lg border border-gray-200 bg-gray-200" />
        ))}
      </ul>
    );
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

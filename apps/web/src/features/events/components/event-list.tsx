"use client";

import { useState } from "react";
import type { ListEventsInput } from "@minitickets/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useEventSearch } from "../hooks/use-event-search";
import { EventListSkeleton } from "./event-list-skeleton";
import { VirtualEventList } from "./virtual-event-list";

// @concept: ui-error-handling
export function EventList({ input, filtered }: { input: ListEventsInput; filtered: boolean }) {
  const [text, setText] = useState("");
  const events = useEventSearch(input, text);
  const items = events.data?.pages.flatMap(page => page.items) ?? [];
  // 1. Previous results remain visible during a new search, but cannot load pages of the old key.
  const busy = events.isFetching || events.typing;
  function more() {
    if (events.hasNextPage && !busy && !events.isPlaceholderData) void events.fetchNextPage();
  }
  return (
    <section aria-label="Search events" className="space-y-4">
      <Input id="event-search" label="Search title or venue" maxLength={200} value={text}
        onChange={event => setText(event.target.value)} />
      <p role="status" className="text-sm text-gray-600">{busy ? "Updating events…" : `${items.length} events loaded`}</p>
      {events.isPending ? <EventListSkeleton /> : null}
      {events.isError ? <div role="alert">
        <p>Something went wrong. Please try again.</p>
        <Button onClick={() => events.refetch()} disabled={events.isFetching}>Retry</Button>
      </div> : null}
      {!events.isPending && !events.isError && items.length === 0 ? <p className="text-gray-600">
        {filtered || text.trim() ? "No upcoming events match these filters" : "No upcoming events"}
      </p> : null}
      {/* 2. Reset the viewport at each debounced search, including searches sharing the first row. */}
      <VirtualEventList key={events.searchKey} items={items} onEnd={more} />
      {events.hasNextPage ? <Button variant="secondary" onClick={more} disabled={busy || events.isPlaceholderData}>
        {events.isFetchingNextPage ? "Loading more…" : "Load more events"}
      </Button> : null}
    </section>
  );
}

import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/lib/trpc/client";

// One event ({ id, title, venue, startsAt, totalSeats, seatsLeft }), for the event page.
// The server already fetched it (../server/prefetch-event.ts) and it arrives with the HTML, so this
// finds it in the cache and makes no request. The event details AND the booking form use this hook
// with the same id, so they share ONE cached answer: when a booking invalidates it, both update.
export function useEvent(id: string) {
  const trpc = useTRPC();
  // 1. The key is [["events","byId"], { input: { id }, type: "query" }]: the server prefetches with
  //    the same input, so hydration finds it.
  // 2. staleTime 10 s: long enough that the browser does not ask again right after hydrating, short
  //    enough that "seats left" is refetched soon when the tab regains focus. (Shorter than the
  //    events list's 30 s: this number sits next to the "Book ticket" button.) A booking from THIS
  //    browser does not wait for it: it invalidates this query at once (use-book-ticket.ts).
  return useQuery(trpc.events.byId.queryOptions({ id }, { staleTime: 10_000 }));
}

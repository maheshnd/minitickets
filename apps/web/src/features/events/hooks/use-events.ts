import type { ListEventsInput } from "@minitickets/shared";
import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/lib/trpc/client";

// @concept: feature-folders
// @concept: csr-vs-ssr
// The upcoming events ({ id, title, venue, startsAt, totalSeats, seatsLeft }[]) for these filters.
// Normally the server already fetched them (../server/prefetch-events.ts) and they arrive with the
// HTML, so this hook finds them in the cache and makes NO request. If the server could not get
// them, the cache is empty and the hook fetches from the browser, as in the client-side-only version.
export function useEvents(input: ListEventsInput) {
  const trpc = useTRPC();
  // @concept: tanstack-query
  // @concept: hydration
  // 1. The cache key is the procedure path PLUS the input:
  //    [["events","list"], { input: { venue: "Pune" }, type: "query" }]. So each filter has its own
  //    cached answer in the browser, and every component asking for the same filters shares one.
  //    The server prefetches with the SAME input (app/events/page.tsx passes one object to both),
  //    so the keys match and hydration finds the data. A different input here (even {} instead of
  //    { venue: "Pune" }) would be a different key: the browser would fetch again.
  // 2. staleTime: 30 s. By default TanStack Query treats data as old the moment it arrives and
  //    re-fetches when a component mounts. The data from the server is only milliseconds old,
  //    so without this the browser would ask for the same list again right after hydrating.
  //    30 s covers the trip to the browser; after that, a remount or a tab focus fetches fresh seats.
  return useQuery(trpc.events.list.queryOptions(input, { staleTime: 30_000 }));
}

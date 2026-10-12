import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/lib/trpc/client";

// @concept: feature-folders
// @concept: csr-vs-ssr
// The upcoming events ({ id, title, venue, startsAt, totalSeats, seatsLeft }[]).
// Normally the server already fetched them (../server/prefetch-events.ts) and they arrive with the
// HTML, so this hook finds them in the cache and makes NO request. If the server could not get
// them, the cache is empty and the hook fetches from the browser, as in the client-side-only version.
export function useEvents() {
  const trpc = useTRPC();
  // @concept: tanstack-query
  // @concept: hydration
  // 1. Same pattern as useProfile: the cache key is the procedure path ("events.list"), so every
  //    component that calls useEvents shares one cached answer. The server uses the same key.
  // 2. staleTime: 30 s. By default TanStack Query treats data as old the moment it arrives and
  //    re-fetches when a component mounts. The data from the server is only milliseconds old,
  //    so without this the browser would ask for the same list again right after hydrating.
  //    30 s covers the trip to the browser; after that, a remount or a tab focus fetches fresh seats.
  return useQuery(trpc.events.list.queryOptions(undefined, { staleTime: 30_000 }));
}

import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/lib/trpc/client";

// @concept: feature-folders
// @concept: csr-vs-ssr
// The upcoming events ({ id, title, venue, startsAt, totalSeats, seatsLeft }[]).
// This is client-side rendering (CSR) on purpose: the browser gets an empty page first, then
// fetches the events. We compare it with server rendering in a later step.
export function useEvents() {
  const trpc = useTRPC();
  // @concept: tanstack-query
  // Same pattern as useProfile: the cache key is the procedure path ("events.list"), so every
  // component that calls useEvents shares one cached answer.
  return useQuery(trpc.events.list.queryOptions());
}

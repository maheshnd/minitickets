import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { ListEventsInput } from "@minitickets/shared";
import { useTRPC } from "@/lib/trpc/client";

// @concept: search-races
export function useEventSearch(filters: ListEventsInput, text: string) {
  const trpc = useTRPC();
  const [q, setQ] = useState("");
  // 1. Debounce typing, and clear each timer so intermediate text never starts a query.
  useEffect(() => {
    const timer = setTimeout(() => setQ(text.trim()), 250);
    return () => clearTimeout(timer);
  }, [text]);
  // 2. Each input has a separate query key. Consuming the abort signal cancels stale requests;
  //    even a server ignoring cancellation can only update its own key, never the new search.
  const query = useInfiniteQuery(trpc.events.search.infiniteQueryOptions(
    { ...filters, q, limit: 50 },
    { getNextPageParam: page => page.nextCursor ?? undefined,
      placeholderData: keepPreviousData, staleTime: 30_000, trpc: { abortOnUnmount: true } },
  ));
  return { ...query, searchKey: q, typing: text.trim() !== q };
}

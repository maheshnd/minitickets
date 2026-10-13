import type { ListEventsInput } from "@minitickets/shared";
import { dehydrate } from "@tanstack/react-query";
import { getQueryClient, getServerTrpc } from "@/lib/trpc/server";
import { canonicalListInput } from "../lib/canonical-input";
import { getCachedEvents } from "./cached-events";

// @concept: csr-vs-ssr
// @concept: hydration
// The server-side twin of useEvents (../hooks/use-events.ts): the only place that fetches events
// on the server. Called by app/events/page.tsx while it renders, with the filters from the URL.
export async function prefetchEvents(input: ListEventsInput) {
  // 1. This request's QueryClient and the server's tRPC helper.
  const queryClient = getQueryClient();
  const trpc = getServerTrpc();

  // 2. Get events.list and store the answer in the QueryClient, under the same key
  //    useEvents uses: the key includes `input`, so the page must give useEvents the SAME input.
  //    The answer comes from the web server's data cache (./cached-events.ts), which asks the API
  //    only on a miss. Two different keys on purpose:
  //    - the React Query key keeps the input AS GIVEN (what the browser will look up);
  //    - the data cache gets the CANONICAL input, so " Pune" and "pune" share one cached answer.
  //    prefetchQuery never throws: if the API fails, the query is just not stored,
  //    and the browser fetches it itself (the old client-side path is the safety net).
  const options = trpc.events.list.queryOptions(input);
  await queryClient.prefetchQuery({
    queryKey: options.queryKey,
    queryFn: () => getCachedEvents(canonicalListInput(input)),
  });

  // 3. Because prefetchQuery hides the error, log it here. The page still works, but slower (one
  //    more round trip from the browser); without this line nobody would notice the server failing.
  const query = queryClient.getQueryState(options.queryKey);
  if (query?.status === "error") {
    console.error("prefetchEvents: events.list failed on the server, the browser will fetch it instead.", query.error);
  }

  // 4. Turn the cache into plain JSON ("dehydrate", like freeze-drying food for transport).
  //    Only successful queries are included. HydrationBoundary sends it to the browser with the HTML.
  return dehydrate(queryClient);
}

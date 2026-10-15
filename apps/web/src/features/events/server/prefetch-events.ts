import type { ListEventsInput } from "@minitickets/shared";
import { dehydrate } from "@tanstack/react-query";
import { getQueryClient, getServerTrpc } from "@/lib/trpc/server";
import { serverLog } from "@/lib/server-log";

// @concept: csr-vs-ssr
// @concept: hydration
export async function prefetchEvents(input: ListEventsInput) {
  const queryClient = getQueryClient();
  const trpc = getServerTrpc();
  // 1. Match the browser's infinite-query key and first page so SSR still needs no browser fetch.
  //    Search bypasses the old list data cache: cursors and arbitrary text would multiply keys.
  const options = trpc.events.search.infiniteQueryOptions({ ...input, q: "", limit: 50 }, {
    getNextPageParam: page => page.nextCursor ?? undefined,
  });
  await queryClient.prefetchInfiniteQuery(options);
  const query = queryClient.getQueryState(options.queryKey);
  if (query?.status === "error") serverLog("error", "prefetchEvents: search failed; browser will retry", {});
  return dehydrate(queryClient);
}

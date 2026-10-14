import { GetEventInput, type Event } from "@minitickets/shared";
import { dehydrate, type DehydratedState } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import { cache } from "react";
import { getQueryClient, getServerTrpc } from "@/lib/trpc/server";

// The server-side twin of useEvent (../hooks/use-event.ts). Called by app/events/[id]/page.tsx, for
// its metadata (the tab title) AND for the page itself.
//
// Returns the event and the cache as plain JSON for HydrationBoundary, or null when there is no such
// event (the page then shows the not-found page). Any other failure (API down, a 500) is THROWN, so
// app/events/error.tsx shows its error page: unlike the events list, the booking page is useless
// without its event, so there is no "the browser fetches it instead" fallback here.
//
// cache() (React): the metadata and the page both call this during ONE request; it runs once and
// both get the same answer (one API call, not two). The next request starts empty again.
export const prefetchEvent = cache(async (id: string): Promise<{ event: Event; state: DehydratedState } | null> => {
  // 1. The id comes from the URL, so anyone can type anything. Not a UUID: not found, without
  //    asking the API (which would answer 400 for a malformed id).
  if (!GetEventInput.safeParse({ id }).success) return null;

  // 2. The same query options (so the same key) the browser's useEvent uses.
  //    fetchQuery, not prefetchQuery: we need the answer here (and its error), not just the cache.
  //    No data cache in front (unlike events.list): "seats left" should be fresh, and a
  //    primary-key lookup is cheap. No cookies are sent: the event is public.
  const queryClient = getQueryClient();
  const options = getServerTrpc().events.byId.queryOptions({ id });
  try {
    const event = await queryClient.fetchQuery(options);
    return { event, state: dehydrate(queryClient) };
  } catch (error) {
    // 3. The API's NotFoundError arrives as a TRPCClientError with httpStatus 404.
    if (error instanceof TRPCClientError && error.data?.httpStatus === 404) return null;
    throw error;
  }
});

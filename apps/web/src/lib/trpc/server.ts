import { QueryClient } from "@tanstack/react-query";
import { createTRPCClient, httpLink } from "@trpc/client";
import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";
import { cache } from "react";
// @concept: end-to-end-types
// Still `import type` only: the web server talks to the API over HTTP, like the browser does,
// and never runs API code itself.
import type { AppRouter } from "@minitickets/api/router";
import { getServerEnv } from "@/lib/server-env";

// The tRPC setup for SERVER Components. The browser's version is ./client.ts.
// Only import this file from server code (pages, server-only helpers), never from "use client" files.

// @concept: hydration
// 1. One QueryClient PER REQUEST. React's cache() remembers the result for the length of one
//    server render, so every Server Component in the same request gets the same QueryClient,
//    and the next request (maybe another visitor) gets a brand new, empty one.
//    WHY not one global QueryClient: it would keep visitor A's data around for visitor B.
//    retry: false: if the API fails we do not make the visitor wait for retries here. The data is
//    simply not sent, and the browser fetches it itself (with its own retries).
export const getQueryClient = cache(
  () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
);

// 2. A plain tRPC client for the server: sends real HTTP requests to API_INTERNAL_URL (web server ->
//    API, never via the browser). httpLink, not httpBatchLink: the server makes one call per page
//    today, so batching buys nothing. Used directly by the cached events fetch
//    (features/events/server/cached-events.ts), and by getServerTrpc below.
//    No cookies are forwarded: events.list is public. A page with private data would have to
//    pass the visitor's "sid" cookie on purpose (and must never put that answer in a SHARED cache).
export function makeServerTrpcClient() {
  return createTRPCClient<AppRouter>({
    links: [httpLink({ url: `${getServerEnv().API_INTERNAL_URL}/trpc` })],
  });
}

// @concept: server-to-server-calls
// 3. A typed tRPC "options proxy" for the server: trpc.events.list.queryOptions() works exactly like
//    the useTRPC() version in the browser, so the query key is the SAME in both
//    ([["events","list"],{type:"query"}]). That shared key is how the browser later finds the data
//    the server put in the cache.
//    - client: the plain client from step 2.
//    - cache() again, so the URL is read at request time (see getServerEnv) and built once per request.
export const getServerTrpc = cache(() =>
  createTRPCOptionsProxy<AppRouter>({
    client: makeServerTrpcClient(),
    queryClient: getQueryClient,
  }),
);

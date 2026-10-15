import type { ListEventsInput } from "@minitickets/shared";
import { HydrationBoundary } from "@tanstack/react-query";
import type { Metadata } from "next";
import { Suspense } from "react";
import { Container } from "@/components/ui/container";
import { EventFilters } from "@/features/events/components/event-filters";
import { EventList } from "@/features/events/components/event-list";
import { EventListSkeleton } from "@/features/events/components/event-list-skeleton";
import { filtersHref, hasFilters, parseFilters, readFilterParams } from "@/features/events/lib/filter-params";
import { prefetchEvents } from "@/features/events/server/prefetch-events";

// @concept: app-router
// @concept: csr-vs-ssr
// The /events route. It is rendered on the server: the first HTML already contains the events.

// 1. Render this page per request; P7 prefetches one bounded search page directly from the API.
//    Search text/cursors bypass the old Redis/Next list caches to avoid multiplying cache keys.
export const dynamic = "force-dynamic";

// 2. The browser tab title. It becomes "Upcoming events | MiniTickets" through the layout's template.
//    generateMetadata runs on the server for each request; today it returns a fixed title.
export async function generateMetadata(): Promise<Metadata> {
  return { title: "Upcoming events" };
}

// @concept: hydration
// 3. The part that WAITS for data. An async Server Component: it runs only on the server.
//    a. prefetchEvents(input) calls the API (server to server) and returns the cache as plain JSON.
//    b. HydrationBoundary sends that JSON to the browser with the HTML and puts it into the
//       browser's QueryClient, so EventList's useEventSearch finds the data and makes no request.
//    c. EventList is the same Client Component as before: rendered to HTML here, made interactive
//       ("hydrated") in the browser.
//    The SAME `input` object goes to prefetchEvents AND to EventList: the query key includes the
//    input, so this is what makes the browser find the server's data under the right key.
async function EventListWithServerData({ input, filtered }: { input: ListEventsInput; filtered: boolean }) {
  const state = await prefetchEvents(input);
  return (
    <HydrationBoundary state={state}>
      <EventList input={input} filtered={filtered} />
    </HydrationBoundary>
  );
}

// @concept: streaming-suspense
// 4. The page. The shell (header, heading, filters, footer) does not need data, so it is sent at once.
//    <Suspense> marks the part that may wait: until EventListWithServerData is ready, the browser
//    shows the skeleton; then the server sends the finished list in the SAME response ("streaming")
//    and a tiny script swaps it in. One request, no second round trip.
// 5. The filters come from the URL (?venue=Pune&from=2026-11-01&to=2026-11-30): see
//    features/events/lib/filter-params.ts for why the URL. `searchParams` is a Promise in Next 16.
//    a. Read them and check them with the shared schema (the API checks again).
//    b. Invalid (a hand-edited URL, e.g. from after to): show the form with the messages and no
//       list. Calling the API would only get a 400.
//    c. A `key` made from the URL on the form and on Suspense: a new URL means a new form (filled
//       from the new URL) and a new Suspense boundary (the skeleton shows while the new list loads,
//       instead of the old list staying on screen as if it matched). The two keys must DIFFER
//       ("form:" / "list:"): they are siblings, and React needs siblings' keys to be unique (with the
//       same key, React mixed them up and showed the form twice).
export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const values = readFilterParams(await searchParams);
  const parsed = parseFilters(values);
  const href = filtersHref(values);

  return (
    <Container className="max-w-2xl py-12">
      <h1 className="mb-6 text-2xl font-bold">Upcoming events</h1>
      <EventFilters key={`form:${href}`} initialValues={values} initialErrors={parsed.success ? {} : parsed.errors} />
      {parsed.success ? (
        <Suspense key={`list:${href}`} fallback={<EventListSkeleton />}>
          <EventListWithServerData input={parsed.input} filtered={hasFilters(values)} />
        </Suspense>
      ) : (
        <p role="alert" className="text-red-700">
          These filters are not valid. Fix them above, or clear them.
        </p>
      )}
    </Container>
  );
}

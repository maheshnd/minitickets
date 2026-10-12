import { HydrationBoundary } from "@tanstack/react-query";
import type { Metadata } from "next";
import { Suspense } from "react";
import { Container } from "@/components/ui/container";
import { EventList } from "@/features/events/components/event-list";
import { EventListSkeleton } from "@/features/events/components/event-list-skeleton";
import { prefetchEvents } from "@/features/events/server/prefetch-events";

// @concept: app-router
// @concept: csr-vs-ssr
// The /events route. It is rendered on the server: the first HTML already contains the events.

// 1. Rendered fresh on every request: no Next.js data cache, no "use cache", no build-time HTML.
//    WHY: this step only changes WHERE the page is rendered (server instead of browser), so the
//    comparison with the client-side version is fair. Caching comes in later steps.
export const dynamic = "force-dynamic";

// 2. The browser tab title. It becomes "Upcoming events | MiniTickets" through the layout's template.
//    generateMetadata runs on the server for each request; today it returns a fixed title.
export async function generateMetadata(): Promise<Metadata> {
  return { title: "Upcoming events" };
}

// @concept: hydration
// 3. The part that WAITS for data. An async Server Component: it runs only on the server.
//    a. prefetchEvents() calls the API (server to server) and returns the cache as plain JSON.
//    b. HydrationBoundary sends that JSON to the browser with the HTML and puts it into the
//       browser's QueryClient, so EventList's useEvents finds the data and makes no request.
//    c. EventList is the same Client Component as before: rendered to HTML here, made interactive
//       ("hydrated") in the browser.
async function EventListWithServerData() {
  const state = await prefetchEvents();
  return (
    <HydrationBoundary state={state}>
      <EventList />
    </HydrationBoundary>
  );
}

// @concept: streaming-suspense
// 4. The page. The shell (header, heading, footer) does not need data, so it is sent at once.
//    <Suspense> marks the part that may wait: until EventListWithServerData is ready, the browser
//    shows the skeleton; then the server sends the finished list in the SAME response ("streaming")
//    and a tiny script swaps it in. One request, no second round trip.
export default function EventsPage() {
  return (
    <Container className="max-w-2xl py-12">
      <h1 className="mb-6 text-2xl font-bold">Upcoming events</h1>
      <Suspense fallback={<EventListSkeleton />}>
        <EventListWithServerData />
      </Suspense>
    </Container>
  );
}

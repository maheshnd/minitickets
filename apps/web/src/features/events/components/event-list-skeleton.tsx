// @concept: streaming-suspense
// Grey placeholder cards, so the page does not jump when the real ones arrive.
// Used in two places: the <Suspense> fallback in app/events/page.tsx (while the server is still
// fetching) and EventList's loading state (when the browser has to fetch by itself).
// No "use client": it has no state, so it works as a Server Component too.
export function EventListSkeleton() {
  return (
    <ul aria-label="Loading events" aria-busy="true" className="space-y-4">
      {[0, 1, 2].map((i) => (
        <li key={i} className="h-28 animate-pulse rounded-lg border border-gray-200 bg-gray-200" />
      ))}
    </ul>
  );
}

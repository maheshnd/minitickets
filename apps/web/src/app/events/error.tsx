"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";

// @concept: ui-error-handling
// @concept: streaming-suspense
// Error boundary for /events. Next.js wraps the page in it: if anything THROWS while the page
// renders (on the server or in the browser), this replaces the page instead of a blank screen.
// It must be a Client Component, because the Retry button needs a click handler.
//
// It is the second safety net. A failed events.list call does NOT end up here: prefetchQuery never
// throws, and the browser then fetches the list itself (EventList shows its own Retry). This
// catches the rest: a missing API_INTERNAL_URL, a bug in a component, and so on.
export default function EventsError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  // 1. Log the real error in the browser console. In production, an error from a Server Component
  //    arrives here without its message (Next.js hides server details); `digest` is an id that
  //    matches the full error in the web server's log.
  useEffect(() => {
    console.error(error);
  }, [error]);

  // 2. A general message (never raw internals) and a way to try again.
  //    retry() asks the server to render the page again; if it works, the page replaces this message.
  return (
    <Container className="max-w-2xl py-12">
      <div role="alert" className="space-y-3">
        <p className="text-red-700">Something went wrong while loading the events. Please try again.</p>
        {error.digest && <p className="text-xs text-gray-500">Error id: {error.digest}</p>}
        <Button variant="secondary" onClick={() => retry()}>
          Retry
        </Button>
      </div>
    </Container>
  );
}

import type { Metadata } from "next";
import { Container } from "@/components/ui/container";
import { EventList } from "@/features/events/components/event-list";

export const metadata: Metadata = { title: "Events" };

// @concept: app-router
// A Server Component that only sets the page frame. The events themselves are fetched in the
// browser by EventList (client-side rendering).
export default function EventsPage() {
  return (
    <Container className="max-w-2xl py-12">
      <h1 className="mb-6 text-2xl font-bold">Upcoming events</h1>
      <EventList />
    </Container>
  );
}

import { HydrationBoundary } from "@tanstack/react-query";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Container } from "@/components/ui/container";
import { BookTicketForm } from "@/features/bookings/components/book-ticket-form";
import { EventDetails } from "@/features/events/components/event-details";
import { prefetchEvent } from "@/features/events/server/prefetch-event";

// The event page, /events/<id>: the event's details and the "Book ticket" form.
// Rendered on the server for every request (a dynamic route): the first HTML already has the event.

type Props = { params: Promise<{ id: string }> };

// 1. The tab title is the event's title, e.g. "Indie Rock Showcase | MiniTickets".
//    prefetchEvent is wrapped in React's cache(), so this and the page below share ONE API call.
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const result = await prefetchEvent((await params).id);
  return { title: result ? result.event.title : "Event not found" };
}

// 2. Fetch the event on the server. No such event (or a malformed id): Next's not-found page (404).
//    Otherwise send the data with the HTML (HydrationBoundary), so the two client components find
//    it in the browser's cache and make no request.
export default async function EventPage({ params }: Props) {
  const { id } = await params;
  const result = await prefetchEvent(id);
  if (!result) notFound();

  return (
    <Container className="max-w-2xl py-12">
      <HydrationBoundary state={result.state}>
        <EventDetails id={id} />
        <BookTicketForm eventId={id} />
      </HydrationBoundary>
    </Container>
  );
}

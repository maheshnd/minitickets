import type { Metadata } from "next";
import { Container } from "@/components/ui/container";
import { CreateEventForm } from "@/features/events/components/create-event-form";

// The title becomes "New event | MiniTickets" through the template in layout.tsx.
export const metadata: Metadata = { title: "New event" };

// A Server Component: it only sets the page frame. proxy.ts sends logged-out visitors to login;
// the form itself shows "not allowed" to non-admins; the API's 403 is the real check.
export default function NewEventPage() {
  return (
    <Container className="max-w-md py-12">
      <h1 className="mb-6 text-2xl font-bold">New event</h1>
      <CreateEventForm />
    </Container>
  );
}

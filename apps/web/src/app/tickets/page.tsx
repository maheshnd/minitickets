import type { Metadata } from "next";
import { Container } from "@/components/ui/container";
import { MyTicketsList } from "@/features/bookings/components/my-tickets-list";

export const metadata: Metadata = { title: "My tickets" };

// A Server Component: it only sets the page frame. proxy.ts redirects logged-out visitors before
// this renders, and the API checks the session again for the data (bookings.mine).
export default function MyTicketsPage() {
  return (
    <Container className="max-w-2xl py-12">
      <h1 className="mb-6 text-2xl font-bold">My tickets</h1>
      <MyTicketsList />
    </Container>
  );
}

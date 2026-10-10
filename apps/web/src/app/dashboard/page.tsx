import type { Metadata } from "next";
import { Container } from "@/components/ui/container";
import { ProfileCard } from "@/features/account/components/profile-card";

export const metadata: Metadata = { title: "Dashboard" };

// A Server Component: it only sets the page frame. proxy.ts redirects logged-out visitors
// before this renders, and the API checks the session again for the data.
export default function DashboardPage() {
  return (
    <Container className="max-w-2xl py-12">
      <h1 className="mb-6 text-2xl font-bold">Dashboard</h1>
      <ProfileCard />
    </Container>
  );
}

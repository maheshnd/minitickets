import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useTRPC } from "@/lib/trpc/client";

// The logged-in user's bookings ("My tickets"), newest first, each with its event's title, venue
// and start time. Fetched in the browser (with the session cookie), never on the server, so this
// private list is never part of any HTML a cache could store.
export function useMyTickets() {
  const trpc = useTRPC();
  const router = useRouter();
  const tickets = useQuery(trpc.bookings.mine.queryOptions());

  // 401 means the cookie is there but the session is not valid any more (expired or deleted),
  // which the route guard in proxy.ts cannot see. Send the user to log in again, then back here.
  const status = tickets.error?.data?.httpStatus;
  useEffect(() => {
    if (status === 401) router.replace("/login?next=/tickets");
  }, [status, router]);

  return tickets;
}

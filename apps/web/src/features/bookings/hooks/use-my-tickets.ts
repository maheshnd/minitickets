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
  // 1. Poll while the worker catches up, then refresh before the two-minute links expire.
  //    Focus refetch repairs links after a sleeping/background tab; private data is not SSR'd.
  const tickets = useQuery(trpc.tickets.mine.queryOptions(undefined, {
    staleTime: 0, refetchOnWindowFocus: "always",
    refetchInterval: query => query.state.data?.some(booking => booking.creationStatus === "creating") ? 2000 : 60_000,
  }));

  // 401 means the cookie is there but the session is not valid any more (expired or deleted),
  // which the route guard in proxy.ts cannot see. Send the user to log in again, then back here.
  const status = tickets.error?.data?.httpStatus;
  useEffect(() => {
    if (status === 401) router.replace("/login?next=/tickets");
  }, [status, router]);

  return tickets;
}

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/lib/trpc/client";
import { shouldRetryBooking } from "../lib/booking-retry";

// Wraps the bookings.create mutation so components never call tRPC directly.
export function useBookTicket(eventId: string) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  // What this browser has cached that a booking (or a failed one) makes out of date. Invalidating
  // marks it stale: a query on screen refetches at once, the others the next time they show.
  // - this event: its seats left changed (after a 409 too: someone else took the seats, so the
  //   number on screen was already wrong);
  // - "My tickets": there is a new booking;
  // - the events lists: their cards show seats left too (queryKey() with no input matches every
  //   filter, see use-create-event.ts).
  // The API invalidated its own caches (Redis, the web server's data cache) already. Other people's
  // browsers keep their copy until their staleTime runs out; the lock in the API keeps that safe.
  const invalidateSeats = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: trpc.events.byId.queryKey({ id: eventId }) }),
      queryClient.invalidateQueries({ queryKey: trpc.events.list.queryKey() }),
    ]);

  return useMutation(
    trpc.bookings.create.mutationOptions({
      // Retries ON for this mutation only (all others: retry 0, see query-provider.tsx): up to 2 more
      // tries on a network error or a 5xx, never on a 4xx. Safe ONLY because each retry sends the SAME
      // input, so the SAME idempotency key, and the API never books one key twice (lib/booking-retry.ts).
      retry: shouldRetryBooking,
      onSuccess: () =>
        Promise.all([invalidateSeats(), queryClient.invalidateQueries({ queryKey: trpc.bookings.mine.queryKey() })]),
      onError: (error) => {
        if (error.data?.httpStatus === 409) return invalidateSeats();
      },
    }),
  );
}

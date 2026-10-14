// Retries for bookings.create (step F2b): the ONE mutation that retries on its own.
//
// Mutations never retry anywhere else (see the "Mutations never retry" comment in
// apps/web/src/providers/query-provider.tsx): if a request succeeded on the server but its response
// was lost, sending it again would DO it again. Booking is the exception, and it is safe ONLY
// BECAUSE every booking request carries an idempotency key: a retry sends the same key, and the API
// answers a repeated key with the booking it already made instead of booking again
// (createBookingTx in apps/api/src/queries/bookings.ts). Without the key, this file would turn a
// lost response into a double booking.

// 1. At most 2 retries, so 3 attempts in all. React Query waits between them (1 s, then 2 s: its
//    default exponential back-off), so a short network hiccup is ridden out without the user
//    noticing, and a long outage ends in an error message after ~3 s instead of hanging.
export const BOOKING_MAX_RETRIES = 2;

// 2. The rule, the same one queries use (shouldRetry in query-provider.tsx):
//    - 4xx: the request itself was refused (400 bad input or already started, 401 logged out,
//      404 unknown event, 409 not enough seats or key reused). The same request gets the same
//      answer again, so never retry.
//    - 5xx: the server failed, maybe for a moment (a restart, a dropped database connection).
//      We cannot know whether the booking was saved before it failed; with the key, a retry is
//      safe either way.
//    - no HTTP status at all: a network error (no answer, or the answer was lost). Exactly the case
//      the idempotency key exists for: the booking may already be saved.
export function shouldRetryBooking(failureCount: number, error: unknown): boolean {
  const status = (error as { data?: { httpStatus?: number } } | null)?.data?.httpStatus;
  if (status !== undefined && status >= 400 && status < 500) return false;
  return failureCount < BOOKING_MAX_RETRIES;
}

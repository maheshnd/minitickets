"use client";

import { MAX_TICKETS_PER_BOOKING } from "@minitickets/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
// Who is logged in is the auth feature's job, and the event is the events feature's: we reuse
// their hooks instead of writing second ones.
import { useMe } from "@/features/auth/hooks/use-me";
import { useEvent } from "@/features/events/hooks/use-event";
import { useBookTicket } from "../hooks/use-book-ticket";

// The API's answers whose message is meant for the visitor: 400 (already started), 404 (event
// gone), 409 (not enough seats left). Anything else gets a general message, never raw internals.
const SHOW_API_MESSAGE = [400, 404, 409];

// "Book ticket" for one event: choose 1-4 tickets, then book.
export function BookTicketForm({ eventId }: { eventId: string }) {
  // 1. The same cached event as EventDetails (one query, see use-event.ts): when a booking
  //    invalidates it, the seats left there and the choices here update together.
  const event = useEvent(eventId);
  const me = useMe();
  const bookTicket = useBookTicket(eventId);
  const router = useRouter();
  const [quantity, setQuantity] = useState(1);
  // How many tickets the last successful booking holds, for the success message (0 = none yet).
  const [booked, setBooked] = useState(0);
  // The message under the button when booking failed ("" = nothing to show).
  const [formError, setFormError] = useState("");

  // 2. EventDetails already shows "Loading..." or the error; the form has nothing to offer then.
  if (!event.data) return null;

  // 3. Offer only what can work right now: 1 to 4, but not more than the seats left. This number
  //    can be out of date (someone else may be booking this very second), so it is only a help:
  //    the API checks again under a lock and answers 409 if the seats are gone by then.
  //    If the seats left shrink after a refetch, the chosen number is lowered to fit.
  const soldOut = event.data.seatsLeft === 0;
  const maxChoice = Math.max(1, Math.min(MAX_TICKETS_PER_BOOKING, event.data.seatsLeft));
  const chosen = Math.min(quantity, maxChoice);
  const choices = Array.from({ length: maxChoice }, (_, i) => i + 1);

  // 4. Where a logged-out visitor goes: the login page, which brings them back here afterwards
  //    (?next=, checked by getSafeNext in the login form). Same URL shape the proxy builds.
  const loginHref = `/login?${new URLSearchParams({ next: `/events/${eventId}` })}`;

  function handleSubmit(formEvent: FormEvent<HTMLFormElement>) {
    // 5. Stop the browser's own full-page submit.
    formEvent.preventDefault();

    // 6. Logged out: go and log in first. (The API would answer 401 anyway; this saves the trip.)
    if (!me.data) {
      router.push(loginHref);
      return;
    }

    // 7. Send it. The API takes the user from the session cookie, never from this form.
    setBooked(0);
    setFormError("");
    bookTicket.mutate(
      { eventId, quantity: chosen },
      {
        onSuccess: (booking) => {
          setBooked(booking.quantity);
          setQuantity(1);
        },
        onError: (error) => {
          const status = error.data?.httpStatus;
          // 7a. The session ran out while the page was open (the header still said "logged in").
          if (status === 401) {
            router.push(loginHref);
            return;
          }
          // 7b. The API's own words for 400 / 404 / 409, e.g. "Not enough seats left".
          setFormError(
            status !== undefined && SHOW_API_MESSAGE.includes(status) ? error.message : "Something went wrong. Please try again.",
          );
        },
      },
    );
  }

  return (
    <form onSubmit={handleSubmit} aria-label="Book tickets" className="mt-6 space-y-4 rounded-lg border border-gray-200 bg-white p-6">
      <div>
        {/* htmlFor + id: clicking the label focuses the select, and screen readers announce it. */}
        <label htmlFor="quantity" className="mb-1 block text-sm font-medium">
          Tickets
        </label>
        <select
          id="quantity"
          value={chosen}
          onChange={(change) => setQuantity(Number(change.target.value))}
          disabled={soldOut}
          className={
            "rounded-md border border-gray-300 bg-white px-3 py-2 text-sm disabled:opacity-60 " +
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
          }
        >
          {choices.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>
      {/* 8. Disabled while the request runs (a double click must not book twice; F2b adds an
             idempotency key for retries), while we don't know yet who is logged in, and when sold out. */}
      <Button type="submit" disabled={soldOut || bookTicket.isPending || me.isPending}>
        {bookTicket.isPending ? "Booking..." : "Book ticket"}
      </Button>
      {/* role="status" makes screen readers announce the text when it appears. */}
      <p role="status" className="text-sm text-green-700">
        {booked > 0 ? (
          <>
            Booked! You have {booked} {booked === 1 ? "ticket" : "tickets"}.{" "}
            <Link href="/tickets" className="font-medium underline">
              My tickets
            </Link>
          </>
        ) : null}
      </p>
      {formError ? (
        <p role="alert" className="text-sm text-red-700">
          {formError}
        </p>
      ) : null}
    </form>
  );
}

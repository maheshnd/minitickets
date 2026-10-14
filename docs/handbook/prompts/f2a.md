# Prompt: F2a, book a ticket + "My tickets"

History: see [CHANGELOG.md](../CHANGELOG.md) or run `pnpm docs:history`

The prompt the owner gave for this step, word for word. Status and results:
[ROADMAP.md](../ROADMAP.md) and [PENDING.md](../PENDING.md).

```text
Feature 2, Step F2a: book a ticket + "My tickets". LOCAL ONLY (no infra
changes). Follow AGENTS.md / CLAUDE.md rules (do not commit; numbered
WHAT/WHY comments).

FIRST, rule + roadmap updates:
1. CLAUDE.md + AGENTS.md: during the ticketing + serverless series, do NOT
   update the handbook, the infra guide or the explorer. Record every
   concept, file and infra change in PENDING.md instead; a detailed guide
   + explorer update is done in one batch after the series. ROADMAP.md
   status is still updated every step (one or two lines).
2. Save step prompts in docs/handbook/prompts/ (one file each); save
   THIS prompt as f2a.md. ROADMAP.md links each "next" item to its
   prompt file when one exists.
3. ROADMAP.md: replace the "next" list with the ticketing series:
   F2a book a ticket; F2b idempotency key for booking; S1 booking
   confirmation email (SQS + Lambda + SES + DLQ + DynamoDB idempotency);
   S2 ticket with QR code via SNS fan-out (Lambda + S3 + presigned
   download); S3 reminder email the day before (EventBridge Scheduler);
   S4 door check-in (API Gateway + Lambda + DynamoDB conditional write);
   then the detailed guide + explorer v2 batch; optional later:
   waitlist, cancel booking, poster upload, Step Functions payment saga.
   Mark F2a in progress.

DATABASE
- New table bookings: id uuid pk, event_id (fk events), user_id
  (fk users), quantity integer CHECK 1..4, status text CHECK in
  ('confirmed') default 'confirmed' (more statuses later),
  created_at timestamptz default now.
- Index on bookings(user_id, created_at) for "My tickets".
  Comment why.
- Generated migration (never push).

SHARED
- BookTicketInput { eventId, quantity (1-4) }.
- BookingSchema + MyTicketsOutput (each booking with its event's title,
  venue, startsAt).

API (layers as usual)
- queries/bookings.ts:
  - createBookingTx(eventId, userId, quantity): ONE transaction:
    1. SELECT ... FROM events WHERE id = $1 FOR UPDATE (row lock)
    2. not found -> NotFoundError; already started -> BAD_REQUEST
       ("This event has already started");
       seats_left < quantity -> ConflictError ("Not enough seats left")
    3. UPDATE events SET seats_left = seats_left - quantity
    4. INSERT the booking, return it
    Comment each step: what the lock does, who waits, why it prevents
    overselling, and the alternative (a single conditional
    "UPDATE ... WHERE seats_left >= $n RETURNING" without an explicit
    lock) with its trade-offs. The CHECK seats_left >= 0 constraint is
    the last safety net.
  - listByUser(userId): bookings joined with their events in ONE query
    (comment: avoids the N+1 problem).
- services/bookings.ts: bookTicket(userId, input) -> createBookingTx,
  then invalidate the events cache (reuse the existing invalidation, so
  seatsLeft on /events updates). Comment the trade-off: with many
  bookings per second, invalidating on every booking would empty the
  cache constantly; fine for now, note it in PENDING.md.
  myTickets(userId).
- procedures/bookings.ts: bookings.create (protectedProcedure, mutation),
  bookings.mine (protectedProcedure, query).

WEB
- app/events/[id]/page.tsx (thin): server-rendered event details
  (title, venue, date, seats left) + a client BookTicketForm.
  Unknown id -> not-found page.
- features/bookings/: hooks use-book-ticket.ts, use-my-tickets.ts;
  components book-ticket-form.tsx (quantity 1-4, "Book ticket" button,
  disabled while pending and when sold out), my-tickets-list.tsx.
- Logged out user clicks "Book ticket" -> go to
  /login?next=/events/<id>.
- On success: show "Booked! You have N ticket(s)" + link to My tickets;
  invalidate the event and my-tickets queries.
- Show the API message for 409 / 400 / 404.
- app/tickets/page.tsx: "My tickets" (protected by the proxy guard).
- Event cards on /events link to their detail page. Header shows
  "My tickets" when logged in.

RACE DEMO: scripts/booking-race-demo.ts, root script "demo:booking-race"
- Creates a test event with 5 seats (directly in the DB) and 20 test
  users (via the signup API), logs them in, then fires 20 booking
  requests for 1 ticket at the SAME moment through the API.
- Prints: how many succeeded (must be 5), how many got 409 (must be 15),
  final seats_left (must be 0), number of bookings rows (must be 5).
- Mode --unsafe: does the same read-then-write WITHOUT a lock directly
  with SQL (not through the API) to show overselling happen.
  Comment clearly that this mode exists only to demonstrate the bug.
- Run it against your OWN API instance (not my :4000) and include the
  output of both modes in your report.

TESTS
- unit: bookTicket calls the transaction then invalidates the cache;
  ConflictError / NotFoundError pass through as 409 / 404.
- e2e: log in, open an event, book 2 tickets -> success message;
  My tickets shows the booking; seats left went down by 2; a sold-out
  event shows "Sold out" with the button disabled; logged out ->
  redirected to login, then back to the event.
- All existing tests still pass; e2e on my servers (tell me if I need to
  run db:migrate first).

PENDING.md entry: concepts (transactions, row locks / SELECT FOR UPDATE,
the lost-update race, conditional UPDATE alternative, CHECK constraint
as last defense, N+1 avoided with a join, cache invalidation on writes
and its cost), files, the race demo results.

DONE WHEN
- typecheck, lint, unit tests pass; e2e passes on my servers.
- Do not commit. Suggested commit message, changed files grouped,
  reading order (start with queries/bookings.ts createBookingTx).
```

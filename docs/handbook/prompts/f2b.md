# Prompt: F2b, idempotency key for booking

History: see [CHANGELOG.md](../CHANGELOG.md) or run `pnpm docs:history`

The prompt the owner gave for this step, word for word. Status and results:
[ROADMAP.md](../ROADMAP.md) and [PENDING.md](../PENDING.md).

```text
Feature 2, Step F2b: idempotency key for booking. LOCAL ONLY. Follow
AGENTS.md / CLAUDE.md rules (do not commit; PENDING.md entry; ROADMAP
status line; save this prompt as docs/handbook/prompts/f2b.md).

RULE UPDATE FIRST
- CLAUDE.md + AGENTS.md: ROADMAP.md status lines and new files in
  docs/handbook/prompts/ do NOT need a CHANGELOG entry (avoids noise).
  Also fill in the old empty "Commit:" line from 2026-10-12 if you can
  find its hash; otherwise mark it "unknown".

THE PROBLEM (comment it at the top of the main file)
A booking succeeds on the server but the response is lost; the browser
retries; without protection the user gets a second booking.

DATABASE
- bookings.idempotency_key (uuid, NOT NULL for new rows; existing rows
  get a generated value in the migration), UNIQUE (user_id,
  idempotency_key). Comment: the key is unique PER USER, so one user's
  key can never collide with another's.

SHARED
- BookTicketInput gains idempotencyKey (uuid, required).

API
- In createBookingTx: insert the booking with the key. If the insert
  hits the unique (user_id, idempotency_key) violation, the whole
  transaction rolls back (so the seats are NOT taken twice); then read
  the existing booking for that user + key:
  - same eventId and quantity -> return the EXISTING booking (same
    response as the first time)
  - different eventId or quantity -> ConflictError("This idempotency key
    was already used for a different booking")
  Comment why this is safe even when two requests with the same key
  arrive at the same moment (the row lock serializes them; the unique
  constraint + rollback makes the second one a no-op).
- Also compare in comments: storing keys in Redis with a TTL, and how
  payment APIs (e.g. Stripe) store the full response. Don't build them.

WEB
- book-ticket-form: create ONE key per booking attempt
  (crypto.randomUUID()), keep it in a ref, reuse it for retries and
  repeated clicks; make a NEW key after a successful booking or when the
  quantity changes. Comment the rule: "one key per intent".
- Turn retries ON for the booking mutation only: retry up to 2 times on
  network errors and 5xx, never on 4xx. Comment: safe now BECAUSE of the
  idempotency key (link to the earlier "no mutation retries" comment).

DEMO: scripts/idempotency-demo.ts, root script "demo:idempotency"
- One user, one event: send the SAME booking (same key) 10 times at
  once -> exactly 1 booking row, all 10 responses carry the same booking
  id, seats taken once.
- Same key with a different quantity -> the conflict error.
- Run against your OWN api instance and include the output.

TESTS
- unit: duplicate key + same request -> existing booking returned,
  seats not changed; duplicate key + different request -> 409; the
  booking mutation retries on 5xx but not on 4xx.
- e2e (Playwright): let the first booking request reach the server but
  make the browser lose its response (route.fetch then abort), so the
  client retries -> exactly ONE booking in My tickets, seats down once.
- All existing tests still pass.

PENDING.md entry: concepts (idempotency, idempotency keys, "one key per
intent", unique constraint + rollback for concurrent duplicates, why
retries become safe, key per user, Redis/Stripe alternatives), files,
demo results.

DONE WHEN
- typecheck, lint, unit tests pass; e2e passes on my servers (tell me
  to run db:migrate first if needed).
- Do not commit. Suggested commit message, changed files grouped,
  reading order (createBookingTx first).
```

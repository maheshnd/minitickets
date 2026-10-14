# Prompt: S1a, booking confirmation through a background queue

History: see [CHANGELOG.md](../CHANGELOG.md) or run `pnpm docs:history`

The prompt the owner gave for this step, word for word. Status and results:
[ROADMAP.md](../ROADMAP.md) and [PENDING.md](../PENDING.md).

```text
Serverless S1a: booking confirmation through a background queue. LOCAL
ONLY (no AWS resources, no infra changes). Follow AGENTS.md / CLAUDE.md
rules (do not commit; PENDING.md entry; ROADMAP status line; save this
prompt as docs/handbook/prompts/s1a.md).

THE FEATURE
When a NEW booking is created, the API puts a "booking confirmed"
message on a queue and answers immediately. A separate worker reads the
message and (for now) logs the email it would send. Slow or failing
email never makes booking slow or fail.

LOCAL QUEUE
- docker-compose: an SQS-compatible queue (ElasticMQ, pinned version)
  with one queue "minitickets-jobs". Comment: it speaks the SQS API, so
  the same AWS SDK code works locally and on AWS; only the endpoint
  changes.
- env (validated with Zod): SQS_ENDPOINT (local only, optional),
  JOBS_QUEUE_URL, AWS_REGION; local dummy credentials in .env.example.
  If JOBS_QUEUE_URL is not set, publishing is turned off with a startup
  warning (so tests and other setups still work).

SHARED
- BookingConfirmedMessage (Zod): type "booking.confirmed", version 1,
  messageId (uuid), bookingId, userEmail, eventTitle, eventVenue,
  eventStartsAt, quantity, occurredAt.
  Comment: (a) versioned so producer and consumer can change safely;
  (b) the message carries everything the email needs ("event-carried
  state transfer"), so the worker never reads the database; on AWS the
  Lambda can then live outside the VPC; (c) it contains an email
  address (personal data): keep messages minimal, never log full
  messages.

API (producer)
- New layer folder apps/api/src/queues/ (like queries/, but for message
  queues; only services call it). Update the layer rule in CLAUDE.md
  and AGENTS.md.
- queues/jobs.ts: publishBookingConfirmed(message), AWS SDK v3 SQS
  client, short timeout.
- services/bookings.ts bookTicket: AFTER the transaction commits, and
  ONLY when a NEW booking was created (not for an idempotent replay from
  F2b), publish the message. If publishing fails: log an error (without
  the email address) and still return the booking. Comment honestly:
  a message can be lost if publishing fails or the process crashes
  right after the commit; the outbox pattern fixes that later (add it
  to ROADMAP as a later step).

WORKER (consumer): new workspace package apps/worker
- src/handlers/booking-confirmed.ts: handleBookingConfirmed(message,
  deps), pure logic with a Mailer passed in. Validates the message with
  the shared schema. Builds the email text (subject + body with event,
  venue, date, quantity).
- src/lambda.ts: Lambda-shaped handler(event: SQSEvent): parses each
  record, calls the handler. Not deployed yet (S1c).
- src/local.ts: local runner: long-polls the queue (ReceiveMessage,
  WaitTimeSeconds 20), converts messages into the SAME SQSEvent shape,
  calls the Lambda handler, deletes a message only after success.
  Comment: the same code path locally and on Lambda.
- src/mailer.ts: Mailer interface + LogMailer (logs subject and the
  recipient's domain only, not the full address). SES comes in S1c.
- Root script "worker:dev"; "pnpm dev" also starts the worker.

TESTS
- worker unit: valid message -> mailer called once with the right
  subject/body; invalid message -> rejected, mailer not called.
- api unit: publish happens AFTER the transaction and only for new
  bookings (not replays); a publish failure doesn't fail the booking.
- All existing tests pass; e2e passes on my servers.

DEMO (show me, on your own instances)
- Book a ticket: the API log shows "published" with a messageId; a
  moment later the worker log shows the email it would send.
- Stop the worker, book 2 more, start it again: both are processed (the
  queue kept them).
- Replay a booking with the same idempotency key: NO second message.

PENDING.md entry: concepts (sync vs async work, producer/consumer, queue
as a buffer, long polling, delete-after-success, at-least-once delivery
preview, message versioning, event-carried state transfer, PII in
messages, same handler locally and on Lambda, the lost-message gap and
the outbox pattern), files, demo results.

DONE WHEN
- typecheck, lint, unit tests pass; e2e passes on my servers (tell me
  what to start first, e.g. db:up for the new queue container).
- Do not commit. Suggested commit message, changed files grouped,
  reading order (worker handler first, then the producer).
```

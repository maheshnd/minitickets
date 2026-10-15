# Prompt: S1b, failure handling for the background jobs

History: see [CHANGELOG.md](../CHANGELOG.md) or run `pnpm docs:history`

The prompt the owner gave for this step, word for word. Status and results:
[ROADMAP.md](../ROADMAP.md) and [PENDING.md](../PENDING.md).

```text
Serverless S1b: failure handling for the background jobs. LOCAL ONLY
(no AWS resources). Follow AGENTS.md / CLAUDE.md rules (do not commit;
PENDING.md entry; ROADMAP status line; save this prompt as
docs/handbook/prompts/s1b.md).

1. DEAD-LETTER QUEUE (poison messages)
- elasticmq.conf: queue "minitickets-jobs-dlq"; the main queue sends a
  message there after maxReceiveCount = 3 failed receives (redrive
  policy). Visibility timeout 30s. Comment both settings: what they
  mean and how they relate (the visibility timeout must be longer than
  the handler's maximum run time).
- Scripts: "jobs:dlq" lists DLQ messages (type, messageId, bookingId,
  receive count; never the email address); "jobs:redrive" moves them
  back to the main queue after a fix. Comment when you would use each.

2. RETRY WITH BACKOFF (temporary failures)
- When a message fails, set its visibility timeout based on the receive
  count (e.g. 10s, 40s, 120s; capped), using ChangeMessageVisibility.
  Comment: an immediate retry often fails again; waiting longer each
  time gives the email service time to recover.

3. IDEMPOTENT CONSUMER (duplicate deliveries)
- docker-compose: DynamoDB Local (pinned version). Table
  "minitickets-processed-jobs", key "jobKey", with a TTL attribute
  (e.g. 30 days). A script creates the table locally.
- jobKey = "booking.confirmed:<bookingId>" (the BUSINESS key, not the
  messageId). Comment why: the same booking could be published twice
  with different messageIds (e.g. by the outbox later).
- Flow in handleBookingConfirmed: check if jobKey is already done ->
  yes: skip and treat as success; no: send the email, then record
  jobKey with a CONDITIONAL put (attribute_not_exists). Comment
  honestly: if the process crashes after sending but before recording,
  the email can be sent twice; that's "at-least-once"; exactly-once
  delivery doesn't really exist; we make it "effectively once" for the
  common cases. Mention a lease/in-progress status as a stronger
  option (not built).
- The DynamoDB access lives in a store module passed in as a dependency
  (testable with a fake).

4. PARTIAL BATCH FAILURES
- lambda.ts returns { batchItemFailures: [{ itemIdentifier }] } for the
  messages that failed, so only those are retried (the
  ReportBatchItemFailures format Lambda uses). The local runner honours
  it: delete the successful ones, apply backoff to the failed ones.
- Invalid messages (bad schema) are failures too, so they end in the
  DLQ after 3 tries.

5. FAULT INJECTION FOR DEMOS (local only)
- env MAILER_FAIL_MODE: "off" (default) | "always" | "first-n:<n>".
  Refuse to start with it set if NODE_ENV is production. Comment: this
  exists only to demonstrate failures.

TESTS (unit, with fakes)
- already processed -> no email, success
- not processed -> email once, then recorded
- conditional put conflict (another worker recorded it) -> success,
  no error
- mailer fails -> failure reported for that message only; others in
  the batch succeed
- backoff values for receive counts 1, 2, 3

DEMO (your own instances; show the output)
- Poison message (version 9) -> 3 tries -> lands in the DLQ;
  jobs:dlq shows it.
- MAILER_FAIL_MODE=first-n:2 -> fails twice with growing waits,
  succeeds on the 3rd try; one email.
- The SAME message sent twice -> one email, second one skipped.
- Batch of 5 with 1 bad -> 4 done, only 1 retried.
- jobs:redrive after "fixing" -> processed.

PENDING.md entry: concepts (poison messages, DLQ, maxReceiveCount,
visibility timeout, backoff, at-least-once delivery, idempotent
consumer with a business key, conditional writes, effectively-once,
partial batch failures, fault injection, redrive), files, demo results.

DONE WHEN
- typecheck, lint, unit tests pass; e2e passes on my servers (tell me
  what to start first).
- Do not commit. Suggested commit message, changed files grouped,
  reading order (handler first).
```

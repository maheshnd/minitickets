# Dead-letter queue (DLQ)

History: see [CHANGELOG.md](../CHANGELOG.md) or run `pnpm docs:history`

Area: Reliability · Status: ✅ built in repository; live AWS acceptance is separate

## 1. In one line

A DLQ retains failed work for diagnosis, not automatic success. Source retention is 4 days and DLQ 14 days; only the named source may redrive to it. Fix the cause before owner-controlled redrive.

## 2. Real-life comparison

A durable work tray keeps the task after the customer leaves; a completed stamp identifies a repeat.

## 3. Picture it

```mermaid
flowchart LR
    n0["Failed consumer"] --> n1
    n1["Visibility delay"] --> n2
    n2["Retry limit"] --> n3
    n3["DLQ and alarm"]
```

## 4. Where in our code

- Anchor: `infra/src/jobs/queues.ts` — `createJobQueues`; follow the numbered comments at this boundary.

`apps/worker/src/batch.ts` returns batchItemFailures; `backoff.ts` sets delay; `infra/src/jobs/queue-trigger.ts` sets worker mapping. `pnpm jobs:dlq` lists local failures; redrive is an explicit owner operation after a fix. Runbook §3.12 has AWS diagnostics; no live alarm drill has been claimed.

## 5. See it yourself

Run `pnpm jobs:dlq` and inspect the asserted outcome described above.

Failure thought experiment: Does an empty queue mean email was delivered? No; inspect completion/provider outcomes too. Do not change a live stack to demonstrate it.

## 6. How it connects

Uses the [current system](../00-big-picture.md); gives a concrete decision to the [scenario](../guides/interview-scenarios.md#dlq-failure) and [explorer tour](../guides/infra-explorer.html?tour=failing-email).

## 7. Our settings and WHY

A DLQ retains failed work for diagnosis, not automatic success. Source retention is 4 days and DLQ 14 days; only the named source may redrive to it. Fix the cause before owner-controlled redrive. Durable failure evidence is better than silently dropping work.

## 8. Trade-offs

Too-short visibility can overlap work; too-large visibility delays recovery. Reserved Lambda concurrency and mapping maximumConcurrency must agree or throttling can consume receives.

## 9. Alternatives and when to choose them

10x: oldest-message age and redrive rate limits. 100x: separate poison-message classes, sampling and SLO-driven alarms.

## 10. What breaks and how we notice

Does an empty queue mean email was delivered? No; inspect completion/provider outcomes too.

## 13. Interview answers at 3 levels

- **Simple:** A DLQ retains failed work for diagnosis, not automatic success.
- **Senior:** Find the booking/correlation id, follow structured logs, inspect queue age and failed attempts, then DLQ and alarm. Fix the root cause before redrive. Visibility timeout hides an in-flight message; it is not deletion. Partial-batch reporting retries only failed records. A poison message should not block all useful work.
- **Lead:** 10x: oldest-message age and redrive rate limits. 100x: separate poison-message classes, sampling and SLO-driven alarms.

## 14. Follow-up questions with answers

Does an empty queue mean email was delivered? No; inspect completion/provider outcomes too.

What should happen before redrive? **Fix the failure cause.**

## 15. Say it in 30 seconds

Find the booking/correlation id, follow structured logs, inspect queue age and failed attempts, then DLQ and alarm. Fix the root cause before redrive. Visibility timeout hides an in-flight message; it is not deletion. Partial-batch reporting retries only failed records. A poison message should not block all useful work.

## 16. Status and production work

Repository implementation and local evidence are described above. Live AWS/CI execution remains owner acceptance. 10x: oldest-message age and redrive rate limits. 100x: separate poison-message classes, sampling and SLO-driven alarms.

## Where it appears in the story

- [app-story: 9c. Side path: outbox, fan-out and recoverable work](../app-story.md#9c-side-path-outbox-fan-out-and-recoverable-work)

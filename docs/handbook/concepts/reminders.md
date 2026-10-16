# Reminders

History: see [CHANGELOG.md](../CHANGELOG.md) or run `pnpm docs:history`

Area: Async · Status: 📖 explain-only

## 1. In one line

Explain-only: a daily Scheduler would invoke a paginated date-index worker and enqueue stable reminder identities; there is no schedule, Lambda or reminder IAM grant.

## 2. Real-life comparison

A durable work tray keeps the task after the customer leaves; a completed stamp identifies a repeat.

## 3. Picture it

```mermaid
flowchart LR
    n0["Daily Scheduler"] --> n1
    n1["Paginated date-index Lambda"] --> n2
    n2["Idempotent reminder message"] --> n3
    n3["Existing mail queue"]
```

## 4. Where in our code

Not in our app as an anchored feature. The proposed or observational location is explained below; it must not be mistaken for a deployed resource.

WHERE IN MINITICKETS: proposed infra/src/jobs/reminders.ts after ticket table, proposed worker reminder handler with paginated date-index queries, and existing SNS/SQS mail boundary extended with a versioned reminder schema. Trust scheduler.amazonaws.com for invoke-only execution role; Lambda role queries only the date index and publishes only the mail destination. No Scheduler, reminder Lambda, IAM grants or reminder UI is built. Do not run a nonexistent demo.


Existing integration point: `infra/src/tickets/storage.ts`.

## 5. See it yourself

Use the linked scenario and tour to trace the existing integration point. This proposed extension has no runnable feature demo.

Failure thought experiment: What if the schedule runs twice? Dedup by stable reminder identity, not invocation id. Do not change a live stack to demonstrate it.

## 6. How it connects

Uses the [current system](../00-big-picture.md); gives a concrete decision to the [scenario](../guides/interview-scenarios.md#reminders) and [explorer tour](../guides/infra-explorer.html?tour=chapter-20).

## 7. Our settings and WHY

Explain-only: a daily Scheduler would invoke a paginated date-index worker and enqueue stable reminder identities; there is no schedule, Lambda or reminder IAM grant. Scheduled work belongs outside user requests and must survive retries.

## 8. Trade-offs

GSI lag means use overlapping windows plus dedup; TTL is not an exact scheduler. Flexible windows spread load but affect delivery timing. Missed schedules need bounded catch-up and DLQ alarms.

## 9. Alternatives and when to choose them

10x: page sizes and sending rate. 100x: shard date partitions, incremental checkpoints and user-local time-zone batches.

## 10. What breaks and how we notice

What if the schedule runs twice? Dedup by stable reminder identity, not invocation id.

## 13. Interview answers at 3 levels

- **Simple:** Explain-only: a daily Scheduler would invoke a paginated date-index worker and enqueue stable reminder identities; there is no schedule, Lambda or reminder IAM grant..
- **Senior:** Use one daily EventBridge schedule to invoke a reminder Lambda, query a bounded date range and enqueue reminder messages. Use explicit reminder identity such as ticketId plus reminder date/type to prevent duplicate sends. Time zone and missed-run semantics are product decisions. A daily schedule does not guarantee exactly one invocation.
- **Lead:** 10x: page sizes and sending rate. 100x: shard date partitions, incremental checkpoints and user-local time-zone batches.

## 14. Follow-up questions with answers

What if the schedule runs twice? Dedup by stable reminder identity, not invocation id.

Which id should deduplicate a reminder? **Ticket plus reminder date/type.**

## 15. Say it in 30 seconds

Use one daily EventBridge schedule to invoke a reminder Lambda, query a bounded date range and enqueue reminder messages. Use explicit reminder identity such as ticketId plus reminder date/type to prevent duplicate sends. Time zone and missed-run semantics are product decisions. A daily schedule does not guarantee exactly one invocation.

## 16. Status and production work

Explain-only: no feature deployment exists. 10x: page sizes and sending rate. 100x: shard date partitions, incremental checkpoints and user-local time-zone batches.

## Where it appears in the story

- [app-story: 9c. Side path: outbox, fan-out and recoverable work](../app-story.md#9c-side-path-outbox-fan-out-and-recoverable-work)

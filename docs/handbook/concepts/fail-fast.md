# Fail fast and timeouts when a dependency is down

History: see [CHANGELOG.md](../CHANGELOG.md) or run `pnpm docs:history`

Area: Reliability · Status: ✅ built in repository; live AWS acceptance is separate

## 1. In one line

Fail-fast bounds resource wait rather than hanging. Postgres now has explicit pool/statement deadlines, Redis operations are bounded, and queue SDK requests enforce connect/hard timeouts; commit outcomes can still be ambiguous.

## 2. Real-life comparison

Two clerks cannot promise the same last seat: one holds the ledger until the reservation is recorded.

## 3. Picture it

```mermaid
flowchart LR
    n0["HTTP request"] --> n1
    n1["Pool wait budget"] --> n2
    n2["SQL budget"] --> n3
    n3["Downstream budget"]
```

## 4. Where in our code

- Anchor: `apps/api/src/db/client.ts` — `db`; follow the numbered comments at this boundary.
- Anchor: `apps/api/src/queries/events-cache.ts` — `CACHE_TIMEOUT_MS`; follow the numbered comments at this boundary.
- Anchor: `apps/api/src/redis/client.ts` — `module configuration`; follow the numbered comments at this boundary.

`apps/api/src/db/client.ts` sets 2 s connect/acquisition and 5 s statements. `apps/api/src/queues/jobs.ts` bounds SDK connection/request time; Redis adapters bound operations. Run `pnpm demo:outbox` for a silent queue timeout. A breaker is explain-only: proposed state in services/outbox.ts around delivery, with half-open probes and durable rows left pending.

## 5. See it yourself

Run `pnpm demo:outbox` and inspect the asserted outcome described above.

Failure thought experiment: Does a timeout prove rollback? No; retry with idempotency and reconcile ambiguous results. Do not change a live stack to demonstrate it.

## 6. How it connects

Uses the [current system](../00-big-picture.md); gives a concrete decision to the [scenario](../guides/interview-scenarios.md#timeouts-pools) and [explorer tour](../guides/infra-explorer.html?tour=sale-day).

## 7. Our settings and WHY

Fail-fast bounds resource wait rather than hanging. Postgres now has explicit pool/statement deadlines, Redis operations are bounded, and queue SDK requests enforce connect/hard timeouts; commit outcomes can still be ambiguous. Unbounded waits keep scarce connections and shutdowns occupied.

## 8. Trade-offs

Timeouts need an overall deadline, not independent budgets longer than the request. Circuit breakers can reject useful probes or hide recovery if poorly tuned.

## 9. Alternatives and when to choose them

10x: pool occupancy/queue metrics. 100x: per-dependency bulkheads, adaptive limits and end-to-end deadlines.

## 10. What breaks and how we notice

Does a timeout prove rollback? No; retry with idempotency and reconcile ambiguous results.

## 13. Interview answers at 3 levels

- **Simple:** Fail-fast bounds resource wait rather than hanging.
- **Senior:** An acquisition timeout bounds waiting for a connection; a statement timeout bounds SQL execution including lock wait. Network timeouts bound downstream calls. None proves an operation did not commit. A circuit breaker can stop repeated calls to an unhealthy dependency, but critical durable work still needs an eventual retry path.
- **Lead:** 10x: pool occupancy/queue metrics. 100x: per-dependency bulkheads, adaptive limits and end-to-end deadlines.

## 14. Follow-up questions with answers

Does a timeout prove rollback? No; retry with idempotency and reconcile ambiguous results.

Does a statement timeout limit pool wait? **No; acquisition has a separate timeout.**

## 15. Say it in 30 seconds

An acquisition timeout bounds waiting for a connection; a statement timeout bounds SQL execution including lock wait. Network timeouts bound downstream calls. None proves an operation did not commit. A circuit breaker can stop repeated calls to an unhealthy dependency, but critical durable work still needs an eventual retry path.

## 16. Status and production work

Repository implementation and local evidence are described above. Live AWS/CI execution remains owner acceptance. 10x: pool occupancy/queue metrics. 100x: per-dependency bulkheads, adaptive limits and end-to-end deadlines.

## Where it appears in the story

- [app-story: 9b. A booking reaches its transaction](../app-story.md#9b-a-booking-reaches-its-transaction)

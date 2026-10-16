# Cache invalidation

History: see [CHANGELOG.md](../CHANGELOG.md) or run `pnpm docs:history`

Area: Performance & Caching · Status: ✅ built in repository; live AWS acceptance is separate

## 1. In one line

Invalidation makes old cached results unreachable after a write. Read the generation before SQL, commit before INCR, then notify the web cache; a slow refill remains in its old generation.

## 2. Real-life comparison

A dated catalogue at the ticket office: many readers can share it, but the clerk must know when a newer edition exists.

## 3. Picture it

```mermaid
flowchart LR
    n0["Commit event"] --> n1
    n1["Increment generation"] --> n2
    n2["New readers use new key"] --> n3
    n3["Old refill expires"]
```

## 4. Where in our code

- Anchor: `apps/api/src/queries/events-cache.ts` — `upcomingKey`; follow the numbered comments at this boundary.
- Anchor: `apps/api/src/services/events.ts` — `listUpcomingEvents`; follow the numbered comments at this boundary.

`apps/api/src/services/events.ts` → `invalidateUpcomingList` runs after event creation. `queries/events-cache.ts` builds generation/filter keys. `queries/web-cache.ts` calls signed Next revalidation. Run `pnpm demo:stampede`; inspect cache invalidation unit tests for late refill and failure.

## 5. See it yourself

Run `pnpm demo:stampede` and inspect the asserted outcome described above.

Failure thought experiment: Why read generation before SQL? Reading after SQL could place old rows in the new generation. Do not change a live stack to demonstrate it.

## 6. How it connects

Uses the [current system](../00-big-picture.md); gives a concrete decision to the [scenario](../guides/interview-scenarios.md#cache-invalidation) and [explorer tour](../guides/infra-explorer.html?tour=search).

## 7. Our settings and WHY

Invalidation makes old cached results unreachable after a write. Read the generation before SQL, commit before INCR, then notify the web cache; a slow refill remains in its old generation. DEL alone allows an in-flight old reader to repopulate the same key.

## 8. Trade-offs

Generation keys increase transient cardinality. Redis and Next/browser caches have separate stale windows; one invalidation does not instantly refresh every tab.

## 9. Alternatives and when to choose them

10x: watch invalidation failures/key churn. 100x: outbox-driven invalidation and explicit freshness SLOs.

## 10. What breaks and how we notice

Why read generation before SQL? Reading after SQL could place old rows in the new generation.

## 13. Interview answers at 3 levels

- **Simple:** Invalidation makes old cached results unreachable after a write.
- **Senior:** Commit the write, then increment a cache generation. A reader captures the generation before its database read and stores only under that generation. A slow pre-write reader can fill its old key, but new readers use the new generation. TTL bounds stale data if invalidation fails; errors are logged instead of undoing a committed event.
- **Lead:** 10x: watch invalidation failures/key churn. 100x: outbox-driven invalidation and explicit freshness SLOs.

## 14. Follow-up questions with answers

Why read generation before SQL? Reading after SQL could place old rows in the new generation.

Which order protects against stale refill? **Read generation before database.**

## 15. Say it in 30 seconds

Commit the write, then increment a cache generation. A reader captures the generation before its database read and stores only under that generation. A slow pre-write reader can fill its old key, but new readers use the new generation. TTL bounds stale data if invalidation fails; errors are logged instead of undoing a committed event.

## 16. Status and production work

Repository implementation and local evidence are described above. Live AWS/CI execution remains owner acceptance. 10x: watch invalidation failures/key churn. 100x: outbox-driven invalidation and explicit freshness SLOs.

## Where it appears in the story

- [app-story: 10c. Public list caches and freshness](../app-story.md#10c-public-list-caches-and-freshness)

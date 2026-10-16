# Postgres page cache

History: see [CHANGELOG.md](../CHANGELOG.md) or run `pnpm docs:history`

Area: Data · Status: 🟡 partial

## 1. In one line

Postgres caches database pages in shared buffers and can benefit from OS page cache. SQL still executes on a hit; Redis result caching and browser caching are different layers.

## 2. Real-life comparison

A dated catalogue at the ticket office: many readers can share it, but the clerk must know when a newer edition exists.

## 3. Picture it

```mermaid
flowchart LR
    n0["SQL plan"] --> n1
    n1["Shared buffers"] --> n2
    n2["OS page cache"] --> n3
    n3["Storage if needed"]
```

## 4. Where in our code

Not in our app as an anchored feature. The proposed or observational location is explained below; it must not be mistaken for a deployed resource.

`apps/api/src/queries/events.ts` still executes SQL on a Redis miss. `pnpm demo:search` reports EXPLAIN plans on its isolated data. Inspect EXPLAIN (ANALYZE, BUFFERS) in a controlled read-only session; warm and cold runs answer different questions. Production cache sizing has not been benchmarked.

## 5. See it yourself

Run `pnpm demo:search` and inspect the asserted outcome described above.

Failure thought experiment: Does a shared-buffer hit skip SQL execution? No. Do not change a live stack to demonstrate it.

## 6. How it connects

Uses the [current system](../00-big-picture.md); gives a concrete decision to the [scenario](../guides/interview-scenarios.md#postgres-cache) and [explorer tour](../guides/infra-explorer.html?tour=database-reach).

## 7. Our settings and WHY

Postgres caches database pages in shared buffers and can benefit from OS page cache. SQL still executes on a hit; Redis result caching and browser caching are different layers. A warm database can be fast without a separate application cache.

## 8. Trade-offs

Larger shared buffers are not unlimited free memory; sorts/work_mem multiply with operations and sessions. Evicting caches just to benchmark can disrupt other workloads.

## 9. Alternatives and when to choose them

10x: inspect hit/read counts and CPU. 100x: tune working set, queries and IO before assuming Redis solves all load.

## 10. What breaks and how we notice

Does a shared-buffer hit skip SQL execution? No.

## 13. Interview answers at 3 levels

- **Simple:** Postgres caches database pages in shared buffers and can benefit from OS page cache.
- **Senior:** Postgres keeps table/index pages in shared buffers, and the operating system can cache file pages too. A cache hit avoids a storage read, but the query still executes: visibility checks, joins, filtering and sorting cost CPU. This is different from Redis storing the finished public events result. There is no general automatic result cache for arbitrary SELECTs.
- **Lead:** 10x: inspect hit/read counts and CPU. 100x: tune working set, queries and IO before assuming Redis solves all load.

## 14. Follow-up questions with answers

Does a shared-buffer hit skip SQL execution? No.

What is stored in shared buffers? **Database pages.**

## 15. Say it in 30 seconds

Postgres keeps table/index pages in shared buffers, and the operating system can cache file pages too. A cache hit avoids a storage read, but the query still executes: visibility checks, joins, filtering and sorting cost CPU. This is different from Redis storing the finished public events result. There is no general automatic result cache for arbitrary SELECTs.

## 16. Status and production work

Repository implementation and local evidence are described above. Live AWS/CI execution remains owner acceptance. 10x: inspect hit/read counts and CPU. 100x: tune working set, queries and IO before assuming Redis solves all load.

## Where it appears in the story

- [app-story: 10c. Public list caches and freshness](../app-story.md#10c-public-list-caches-and-freshness)

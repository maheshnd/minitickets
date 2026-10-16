# Client-side vs server-side rendering

History: see [CHANGELOG.md](../CHANGELOG.md) or run `pnpm docs:history`

Area: Frontend · Status: ✅ built in repository; live AWS acceptance is separate

## 1. In one line

The catalogue SSR prefetches events.search into a per-request QueryClient and the browser hydrates the same infinite key. HTML is now dynamically nonced/no-store; client search remains interactive and data caches are separate.

## 2. Real-life comparison

A catalogue with a bookmark: each question and position has its own identity, and only the visible page lies open.

## 3. Picture it

```mermaid
flowchart LR
    n0["Incoming request"] --> n1
    n1["Dynamic nonce HTML"] --> n2
    n2["Hydrated public data"] --> n3
    n3["Interactive client"]
```

## 4. Where in our code

- Anchor: `apps/web/e2e/events.spec.ts` — `response`; follow the numbered comments at this boundary.
- Anchor: `apps/web/src/app/events/page.tsx` — `dynamic`; follow the numbered comments at this boundary.
- Anchor: `apps/web/src/features/events/hooks/use-events.ts` — `useEvents`; follow the numbered comments at this boundary.
- Anchor: `apps/web/src/features/events/server/prefetch-events.ts` — `prefetchEvents`; follow the numbered comments at this boundary.

`apps/web/src/app/layout.tsx` waits for a request; `apps/web/src/features/events/server/prefetch-events.ts` hydrates public data. `apps/web/src/features/events/server/cached-events.ts` provides an explicit public-data cache; the current search-prefetch path bypasses that helper to avoid unbounded cursor/text keys. Run `pnpm demo:security` for production HTML/cache acceptance; there is no static-site export.

## 5. See it yourself

Run `pnpm demo:security` and inspect the asserted outcome described above.

Failure thought experiment: Does dynamic HTML forbid cached data? No. Cache only public results with complete keys. Do not change a live stack to demonstrate it.

## 6. How it connects

Uses the [current system](../00-big-picture.md); gives a concrete decision to the [scenario](../guides/interview-scenarios.md#rendering-models) and [explorer tour](../guides/infra-explorer.html?tour=search).

## 7. Our settings and WHY

The catalogue SSR prefetches events.search into a per-request QueryClient and the browser hydrates the same infinite key. HTML is now dynamically nonced/no-store; client search remains interactive and data caches are separate. Initial content and interactivity have different latency and security constraints.

## 8. Trade-offs

Static HTML has cheap delivery but cannot reuse a fresh per-request nonce. CSR adds client work. Dynamic HTML costs server work even when data is cached.

## 9. Alternatives and when to choose them

10x: measure TTFB/cache hit rate. 100x: evaluate hash-based static CSP or separating public/static routes as a deliberate redesign.

## 10. What breaks and how we notice

Does dynamic HTML forbid cached data? No. Cache only public results with complete keys.

## 13. Interview answers at 3 levels

- **Simple:** The catalogue SSR prefetches events.search into a per-request QueryClient and the browser hydrates the same infinite key.
- **Senior:** SSR sends useful initial HTML, CSR handles interactive changes and static output suits public content that tolerates rebuilds. MiniTickets combines server-prefetched catalogue data with client queries. P10 nonce security makes HTML dynamic and no-store; explicit public data caching remains a separate choice.
- **Lead:** 10x: measure TTFB/cache hit rate. 100x: evaluate hash-based static CSP or separating public/static routes as a deliberate redesign.

## 14. Follow-up questions with answers

Does dynamic HTML forbid cached data? No. Cache only public results with complete keys.

Can public data still be cached inside dynamic HTML rendering? **Yes with correct data keys.**

## 15. Say it in 30 seconds

SSR sends useful initial HTML, CSR handles interactive changes and static output suits public content that tolerates rebuilds. MiniTickets combines server-prefetched catalogue data with client queries. P10 nonce security makes HTML dynamic and no-store; explicit public data caching remains a separate choice.

## 16. Status and production work

Repository implementation and local evidence are described above. Live AWS/CI execution remains owner acceptance. 10x: measure TTFB/cache hit rate. 100x: evaluate hash-based static CSP or separating public/static routes as a deliberate redesign.

## Where it appears in the story

- [app-story: 1b. Search input, hydration and bounded rows](../app-story.md#1b-search-input-hydration-and-bounded-rows)

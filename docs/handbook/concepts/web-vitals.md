# Web vitals

History: see [CHANGELOG.md](../CHANGELOG.md) or run `pnpm docs:history`

Area: Frontend · Status: ✅ built in repository; live AWS acceptance is separate

## 1. In one line

Web Vitals measure field experience. LCP/INP/CLS plus TTFB/FCP are logged through a bounded normalized-route endpoint; no analytics dashboard, sampling pipeline or Lighthouse CI is built.

## 2. Real-life comparison

A stopwatch on a real visitor’s journey answers different questions from a rehearsed practice lap.

## 3. Picture it

```mermaid
flowchart LR
    n0["Browser observation"] --> n1
    n1["Normalized bounded report"] --> n2
    n2["API structured log"] --> n3
    n3["Investigate route distribution"]
```

## 4. Where in our code

- Anchor: `apps/api/src/services/telemetry.ts` — `reportVital`; follow the numbered comments at this boundary.
- Anchor: `apps/web/src/features/telemetry/hooks/use-web-vitals.ts` — `report`; follow the numbered comments at this boundary.
- Anchor: `packages/shared/src/schemas/web-vitals.ts` — `WebVitalInput`; follow the numbered comments at this boundary.

`apps/web/src/features/telemetry/hooks/use-web-vitals.ts` reports bounded values and normalized routes to telemetry.report; `apps/api/src/services/telemetry.ts` logs webVital without query strings or user ids. Run `pnpm demo:security`; the browser test interacts to produce INP and checks request validation. No reporting dashboard or sampling service is built.

## 5. See it yourself

Run `pnpm demo:security` and inspect the asserted outcome described above.

Failure thought experiment: Why no INP on a page never touched? It needs qualifying interactions. Do not change a live stack to demonstrate it.

## 6. How it connects

Uses the [current system](../00-big-picture.md); gives a concrete decision to the [scenario](../guides/interview-scenarios.md#web-vitals) and [explorer tour](../guides/infra-explorer.html?tour=security-layers).

## 7. Our settings and WHY

Web Vitals measure field experience. LCP/INP/CLS plus TTFB/FCP are logged through a bounded normalized-route endpoint; no analytics dashboard, sampling pipeline or Lighthouse CI is built. Field data catches slow devices, real network conditions and long interactions.

## 8. Trade-offs

Logs are simple but not a percentile analytics product. Client reports are untrusted. Lighthouse is repeatable lab evidence, not field truth.

## 9. Alternatives and when to choose them

10x: sample ingestion and group by device/network. 100x: dedicated metrics pipeline, retention and privacy budgets.

## 10. What breaks and how we notice

Why no INP on a page never touched? It needs qualifying interactions.

## 13. Interview answers at 3 levels

- **Simple:** Web Vitals measure field experience.
- **Senior:** LCP measures the main content appearing, INP interaction responsiveness and CLS unexpected layout shifts. Use field measurements grouped by route/device and percentile, then reproduce slow cases in lab tools. A single fast laptop run is not a user population. Good Core Web Vitals target the 75th percentile: LCP ≤2.5 s, INP ≤200 ms and CLS ≤0.1.
- **Lead:** 10x: sample ingestion and group by device/network. 100x: dedicated metrics pipeline, retention and privacy budgets.

## 14. Follow-up questions with answers

Why no INP on a page never touched? It needs qualifying interactions.

Which metric measures interaction responsiveness? **INP.**

## 15. Say it in 30 seconds

LCP measures the main content appearing, INP interaction responsiveness and CLS unexpected layout shifts. Use field measurements grouped by route/device and percentile, then reproduce slow cases in lab tools. A single fast laptop run is not a user population. Good Core Web Vitals target the 75th percentile: LCP ≤2.5 s, INP ≤200 ms and CLS ≤0.1.

## 16. Status and production work

Repository implementation and local evidence are described above. Live AWS/CI execution remains owner acceptance. 10x: sample ingestion and group by device/network. 100x: dedicated metrics pipeline, retention and privacy budgets.

## Where it appears in the story

- [app-story: 1c. Side path: browser vitals and accessibility](../app-story.md#1c-side-path-browser-vitals-and-accessibility)

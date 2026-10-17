# Web vitals

History: see [CHANGELOG.md](../CHANGELOG.md) or run `pnpm docs:history`

Area: Frontend · Status: ✅ built in repository; live AWS acceptance is separate

<!-- interview-card: v2 -->

## 1. What is it?

Web Vitals measure how a page feels in a real browser: when useful content appears, how quickly interactions respond and whether the layout unexpectedly moves.

## 2. Why do we need it?

MiniTickets may feel fast on the developer’s laptop but slow on a buyer’s phone. Browser measurements help identify real experiences that a server response time alone misses.

## 3. How does it work?

```mermaid
flowchart LR
    B["MiniTickets visitor browser"] -->|"observe content, interaction and layout"| H["useWebVitals"]
    H -->|"send bounded report with normalized route"| A["telemetry.report"]
    A -->|"validate untrusted input"| S["reportVital service"]
    S -->|"write webVital JSON event"| L["API logs"]
```

1. Observe browser experience during actual page use.
2. Normalize route identity and validate the report.
3. Record the measurement; use separate analysis to understand distributions.

## 4. How do we use it in MiniTickets?

The browser reports performance to the API, which logs it without query strings or user IDs. This reporting path is built, but a percentile dashboard and sampling pipeline are not. An untouched page may have no interaction measurement.

## 5. Interview-ready answer

“MiniTickets collects browser performance measurements rather than assuming server speed equals user experience. It reports content appearance, interaction responsiveness and layout stability through a validated endpoint and structured logs. The reports are untrusted and privacy-limited. We have collection, not a complete analytics product; useful conclusions would require representative populations and percentile analysis, with lab tools used to reproduce specific slow cases.”

## 6. Important follow-up questions

- **What does interaction responsiveness mean?** How long the browser takes to visibly respond after a qualifying interaction.
- **Why might INP be absent?** The page needs qualifying interactions before an interaction metric can exist.
- **Can a client report be trusted?** No. Validate and bound it; do not use it for authorization or critical accounting.
- **Does a fast lab run prove field performance?** No. Real devices, networks and interactions vary.

## 7. Advanced details

<details>
<summary>Technical reference</summary>

### Metrics and implementation

LCP measures main content appearance; INP interaction responsiveness; CLS unexpected layout movement. TTFB/FCP are also reported. Reference good Core Web Vitals targets at the **75th percentile**: LCP ≤**2.5 s**, INP ≤**200 ms**, CLS ≤**0.1**; these are external guidance, not measured MiniTickets service guarantees.

`apps/web/src/features/telemetry/hooks/use-web-vitals.ts` submits bounded values and normalized routes to `telemetry.report`. `packages/shared/src/schemas/web-vitals.ts` validates external input; `apps/api/src/services/telemetry.ts` logs `webVital` without query strings or user IDs. No analytics dashboard, sampling service or Lighthouse CI job is built.

### Evidence and growth

`pnpm demo:security` includes browser interaction to produce INP and validates the request boundary. This rewrite did not rerun it and claims no live AWS acceptance. Logs are not percentile analytics. Future work may sample ingestion, group suitable populations by route/device/network and add a metrics backend with explicit retention/privacy budgets. Lighthouse supplies reproducible lab evidence, not real-user field truth.

### Code anchors

- Anchor: `apps/api/src/services/telemetry.ts` — `reportVital`; follow the numbered comments at this boundary.
- Anchor: `apps/web/src/features/telemetry/hooks/use-web-vitals.ts` — `report`; follow the numbered comments at this boundary.
- Anchor: `packages/shared/src/schemas/web-vitals.ts` — `WebVitalInput`; follow the numbered comments at this boundary.

### Related reading

[current system](../00-big-picture.md) · [scenario](../guides/interview-scenarios.md#web-vitals) · [explorer tour](../guides/infra-explorer.html?tour=security-layers)

[Open this concept in the city explorer](../guides/infra-explorer.html?concept=web-vitals#chapter=8&piece=web-task).

## Where it appears in the story

- [app-story: 1c. Side path: browser vitals and accessibility](../app-story.md#1c-side-path-browser-vitals-and-accessibility)

</details>

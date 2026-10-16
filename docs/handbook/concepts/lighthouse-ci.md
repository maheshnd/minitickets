# Lighthouse ci

History: see [CHANGELOG.md](../CHANGELOG.md) or run `pnpm docs:history`

Area: Testing · Status: 📖 explain-only

## 1. In one line

Explain-only: CI could audit a seeded production build with calibrated metric/asset budgets. P10 field-vital logs and axe checks are built, but no Lighthouse package/job is installed.

## 2. Real-life comparison

Two clerks cannot promise the same last seat: one holds the ledger until the reservation is recorded.

## 3. Picture it

```mermaid
flowchart LR
    n0["Published production build"] --> n1
    n1["Fixed audit fixture"] --> n2
    n2["Repeated lab runs"] --> n3
    n3["Budget comparison"]
```

## 4. Where in our code

Not in our app as an anchored feature. The proposed or observational location is explained below; it must not be mistaken for a deployed resource.

WHERE IN MINITICKETS: proposed Lighthouse CI config at repo root and a job after web build in .github/workflows/ci.yml, serving isolated API/web ports with seeded public events. Set budgets for LCP/CLS, JS bytes and accessibility; collect several runs and retain reports. No Lighthouse dependency, config or CI job is installed. P10 field telemetry is built separately.


Existing integration point: `.github/workflows/ci.yml`.

## 5. See it yourself

Use the linked scenario and tour to trace the existing integration point. This proposed extension has no runnable feature demo.

Failure thought experiment: Can a good lab score prove p75 field INP? No; real interactions and device populations differ. Do not change a live stack to demonstrate it.

## 6. How it connects

Uses the [current system](../00-big-picture.md); gives a concrete decision to the [scenario](../guides/interview-scenarios.md#lighthouse) and [explorer tour](../guides/infra-explorer.html?tour=security-layers).

## 7. Our settings and WHY

Explain-only: CI could audit a seeded production build with calibrated metric/asset budgets. P10 field-vital logs and axe checks are built, but no Lighthouse package/job is installed. A lab gate catches a large regression before release.

## 8. Trade-offs

Shared CI runners are noisy; hard score thresholds can be flaky. Use calibrated metric/asset budgets and compare medians with a baseline.

## 9. Alternatives and when to choose them

10x: representative routes/devices. 100x: controlled runners, trend storage and field/lab correlation.

## 10. What breaks and how we notice

Can a good lab score prove p75 field INP? No; real interactions and device populations differ.

## 13. Interview answers at 3 levels

- **Simple:** Explain-only: CI could audit a seeded production build with calibrated metric/asset budgets.
- **Senior:** Run repeatable audits against a production build with fixed data and explicit budgets. Track trends and regressions, not a perfect score. Lab metrics help diagnose reproducible work; field vitals reveal real user distributions. Axe remains a separate P10 gate already built.
- **Lead:** 10x: representative routes/devices. 100x: controlled runners, trend storage and field/lab correlation.

## 14. Follow-up questions with answers

Can a good lab score prove p75 field INP? No; real interactions and device populations differ.

Which build should an audit measure? **Production build.**

## 15. Say it in 30 seconds

Run repeatable audits against a production build with fixed data and explicit budgets. Track trends and regressions, not a perfect score. Lab metrics help diagnose reproducible work; field vitals reveal real user distributions. Axe remains a separate P10 gate already built.

## 16. Status and production work

Explain-only: no feature deployment exists. 10x: representative routes/devices. 100x: controlled runners, trend storage and field/lab correlation.

## Where it appears in the story

- [app-story: 9b. A booking reaches its transaction](../app-story.md#9b-a-booking-reaches-its-transaction)

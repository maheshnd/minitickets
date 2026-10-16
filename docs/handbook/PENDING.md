# Pending for the next handbook catch-up

One entry per feature step whose docs are not written yet. The catch-up step turns these into step
docs, cards, story chapters and a CHANGELOG entry, then clears this list (see CLAUDE.md, "Workflow").

## Events e2e timeouts: telemetry completion and explicit readiness

- Diagnosis: a 15-second headless trace on the owner's :3000/:4000 saw 33 requests, zero browser `events.search`, and four `telemetry.report` responses (200) left pending with unread bodies; consuming them completed all four, with HMR still connected.
- App: `apps/web/src/features/telemetry/hooks/use-web-vitals.ts` → `report` drains the small acknowledgement; `apps/web/src/features/events/components/event-list.tsx` → `EventList` exposes its own hydration state through `data-hydrated`.
- Tests: `apps/web/e2e/{events,event-search}.spec.ts` replace all five `networkidle` waits with hydration/specific-request waits; a new test checks API request completion and no further API requests during 15 seconds without interaction.
- Regression evidence: the new test failed before the telemetry fix with exactly four pending calls, then passed after it.
- Verification: `pnpm test:e2e e2e/events.spec.ts e2e/event-search.spec.ts --workers=1` on owner dev: 7 passed / 1 skipped; isolated `next build` + Playwright with `E2E_PRODUCTION_BUILD=1` on :3101/:4101: 7 passed / 1 skipped (10k demo only).
- Other checks: `pnpm typecheck`, `pnpm lint`, and `pnpm test` passed (57 files / 404 unit tests); `git diff --check` passed. Full e2e suite and isolated 10k dataset were not run.
- Catch-up: `pnpm docs:check` reports stale generated code tours after these anchored source edits; regenerate them during the next handbook catch-up. No infrastructure changed; only recorded test PIDs were stopped, leaving owner servers running.

## Production e2e runner and generated tour refresh

- Entry point: `package.json` → `test:e2e:prod`; `scripts/test-e2e-prod.ts` builds a disposable sibling copy of the web sources, runs `next start` on :3100 and a separate API on :4100, then runs all Playwright specs with production flags.
- Safety: preflight both ports; spawn direct Node children, record their PIDs immediately, and stop only those PIDs in `finally` on success/failure/SIGINT/SIGTERM; remove only the temporary copy. Owner web build/types and :3000/:4000 processes stay untouched.
- Configuration: `apps/web/playwright.config.ts` suppresses CI-owned servers for `E2E_LOCAL_API=1`; `apps/web/e2e/admin-events.spec.ts` uses the same local opt-in so admin coverage runs without enabling worker-dependent demos. Existing DB/Redis are used; tests create users/events and book seeded seats.
- Measured: `pnpm test:e2e:prod` passed 43 / skipped 7 (50 discovered); skips are the existing P4/P7/P8/P10 demo cases. Typecheck and lint passed.
- Lifecycle probes: occupied :3100 refused with exit 1 and its listener preserved; deliberate no-tests failure returned 1 and released both ports; SIGTERM returned 143, released both ports and removed the temporary copy. Owner PIDs remained 72128 (web) / 72114 (API).
- Generated refresh: `pnpm docs:build` rebuilt 332 snippets from 152 files in `generated/code-tours.json` and the embedded data in `guides/{code-tours,infra-explorer}.html`; this resolves the stale-tour issue in the preceding entry. `pnpm docs:check` passed (151 cards / 141 slugs / 331 anchor places).
- No infrastructure or dependencies changed; isolated demo datasets/worker pipelines were not provisioned for this runner.

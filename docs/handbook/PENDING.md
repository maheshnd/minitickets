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

## Production e2e runner: shipped standalone server

- `scripts/test-e2e-prod.ts` → production launch now runs the generated standalone `server.js` directly with Node, matching `apps/web/Dockerfile` rather than `next start`.
- Standalone preserves the monorepo path (`apps/<temporary-app>/server.js`); copy `.next/static` and optional `public/` beside that server, as the runtime image does.
- Runtime uses explicit `HOSTNAME=127.0.0.1` and `PORT=3100`; the API stays on :4100. Existing port preflight, temporary build isolation and recorded-PID cleanup are preserved.
- Verification: `pnpm test:e2e:prod` passed 43 / skipped 7 (50 discovered), including production CSP, HSTS, browser hydration and static asset loading; only worker/demo-specific cases stayed skipped.
- Other checks: `pnpm typecheck`, `pnpm lint` and `pnpm test` passed (57 files / 404 tests); baseline `pnpm docs:check` passed (151 cards / 141 slugs / 331 anchor places).
- Deploy preflight: actionlint 1.7.12 passed; critical-threshold audit passed with 1 high / 1 moderate remaining. Fresh arm64 Docker builds passed, but Trivy 0.70.0 CRITICAL gates failed API/web (7 each), worker passed (0); their official Node amd64 base also failed (7), while full GitHub amd64 images remain unrun.
- Cleanup: the runner stopped only its web PID 80403 and API PID 80402 and removed its temporary build. No infrastructure, dependencies or owner servers changed.

## Runtime image security and fixable-critical gate

- Runtime: `apps/{api,web}/Dockerfile` pins `node:24.22.0-bookworm-slim`, applies Debian's `perl-base` security update (measured `5.36.0-7+deb12u4`) and removes npm/npx/Corepack/Yarn plus shims; build stages and `.nvmrc` stay unchanged.
- Policy: `.github/workflows/ci.yml` keeps CRITICAL/exit 1 for all three images with `ignore-unfixed`; `.trivyignore` records only `CVE-2023-45853`, Debian's absent contrib/minizip code, expiring 2026-11-14. The global no-fix filter is independent of that expiry.
- Images: all six arm64/amd64 builds passed. Trivy 0.70.0 raw CRITICALs before → after: API 7 → 1, web 7 → 1, worker 0 → 0; both architectures have only the unfixed zlib finding, and all six configured gates return 0.
- Gate probes: old API still fails with 6 fixable CRITICALs; the specific unexpired ignore passes, while an expired copy exposes the zlib finding and fails without `ignore-unfixed`.
- Audit: `pnpm-workspace.yaml` scopes `@esbuild-kit/core-utils@3.3.2>esbuild` to 0.25.12; lockfile removes 0.18.20. Legacy loader sync/async transforms, Drizzle check and frozen install pass. Audit has 1 high braces (no published fix), 0 moderate/critical; no audit ignore.
- Browser: shared-database run had 35 passed / 8 failed / 7 skipped from accumulated event fixtures; disposable migrated/seeded database rerun of `pnpm test:e2e:prod` passed 43 / skipped 7 and removed its database/PIDs.
- Startup: final API/web images on both architectures run Node 24.22.0 as uid 1000, with patched Perl and no package managers; native Argon2, API ready, web SSR/static/CSP/no-store and both Lambda handlers pass. Only recorded test CIDs/PIDs were stopped.
- Other checks: typecheck, lint, 404 unit tests / 57 files, actionlint and docs:check pass; generated source tours refreshed (332 snippets / 152 files). No AWS changes, image push, new dependency or owner-server restart.

## New AWS account bootstrap: stack-derived names + `pnpm infra:bootstrap`

- Concepts: names derived from the Pulumi stack (`infra/src/names.ts` → `namesFor`, `infra/src/stack.ts` → `names`/`prefix`); GitHub repo vs environment variables; targeted bootstrap (`pulumi up --target`); importing a shared OIDC provider; idempotent setup scripts; Cloudflare DNS-only records.
- Infra: no AWS change. Every layer imports `prefix`; SSM/log/secret paths, tags `Env`, the deploy role's trust `:environment:<stack>` and its SSM path rule, alarm names/descriptions, dashboard text all come from `names`. `pulumi preview --stack dev`: **128 unchanged, 0 create/update/replace/delete**.
- CD (`.github/workflows/cd.yml`): no hard-coded names. publish job → repo vars `AWS_REGION`, `AWS_PUBLISH_ROLE_ARN`, `API/WEB/WORKER_REPO_NAME` (no environment: its OIDC sub must stay `:ref:refs/heads/main`); deploy job → environment `vars.DEPLOY_ENVIRONMENT` / dispatch input `type: environment`, env vars `PULUMI_STACK`, `AWS_REGION`, `AWS_DEPLOY_ROLE_ARN`, 3 repo names, `WORKER_/TICKET_FUNCTION_NAME`, `IMAGE_TAG_PARAMETER`, `DEPLOYED_COMMIT_PARAMETER`; "Check setup" fails on any missing one; ECS-event step reads service names from stack outputs.
- Script: `scripts/infra-bootstrap.ts` + `scripts/bootstrap/{args,targets,github-variables,aws,pulumi,github,dns,checks,prompt,shell}.ts`; 14 targets (`targets.ts` → `bootstrapTargets`). Dry run on dev: "AWS: nothing to create" (14 same), 15 GitHub variables to set, 4 DNS records live, ACM ISSUED, SES verified, alerts subscription pending, Lambda limit 10.
- Docs: `docs/21-new-aws-account.md` (number clashes with `21-events-list.md`); README + `docs/20-deploy-day.md` link it.
- Catch-up must update `guides/cicd-story.md` (quotes the old top-level `env:` block, `options: [dev]`, `'dev'` default, `pulumi stack select dev`) and the infra guide/explorer CD chapter (GitHub variables, bootstrap).
- Unsure: `pulumi import --protect=false --generate-code=false` flags not verified (guard blocks even `--help`); the CloudFront support-case category name.

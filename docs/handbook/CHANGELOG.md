# Handbook changelog

What changed in `docs/handbook/`, commit by commit, newest first, and **why**. The pages
themselves hold no hand-written dates; each one points here under its title.

```mermaid
flowchart LR
    edit["change handbook files"] --> entry["add an entry at the TOP<br/>date, subject, files + sections, why"]
    entry --> prev["fill in the hash of the<br/>PREVIOUS entry"]
    prev --> commit["commit<br/>(its own hash: filled in next time)"]
```

**How to add an entry** (the rule is also in the repo's `CLAUDE.md`):

1. Run `pnpm docs:history --since <hash of the previous entry>`. It lists every handbook file
   changed since then, with the section headings that changed (read from git, including
   uncommitted changes).
2. Add a new entry at the top: `## YYYY-MM-DD · <commit subject>`, a `Why:` line, and one line per
   changed file: which sections were added or changed, and why.
3. A commit can't contain its own hash, so write `Commit: 97f9cab`,
   and replace that text in the **previous** entry with its real hash
   (`git log -1 --format=%h -- docs/handbook`).

`pnpm docs:history` (no arguments) shows the last change date and commit of every file.

---

## 2026-10-15 · feat(observability): correlation id end to end, JSON logs, CloudWatch alarms + SNS email + dashboard (series 2, P2 = S1d)

Commit: filled in by the next handbook commit

Why: Series 2, phase P2 (S1d). The series asks for `@concept` anchors on new code, so 5 existing
cards gain anchor lines, and their status notes say the card text predates P2 (the full rewrite is
the D3 catch-up's job). `pnpm docs:history --since 5fc1dee` lists the files below. (5fc1dee, the CD
deploy guard, changed only PENDING.md and a ROADMAP status line: no entry needed.)

- `concepts/correlation-ids.md`: status note; "4. Where in our code": the app.ts line now says
  `genReqId` + `LogController` (`correlationId`, was `reqId`), plus `apps/api/src/http/correlation-id.ts`,
  `packages/shared/src/schemas/jobs.ts`, `apps/worker/src/correlation.ts`.
- `concepts/structured-logging.md`: "4. Where in our code" gains the worker's `log.ts` and the web
  server's `server-log.ts`.
- `concepts/alerting.md`: status note; "4. Where in our code" gains `alarm-specs.ts` and `alert-topic.ts`.
- `concepts/metrics.md`: "4. Where in our code" gains `dashboard-body.ts`.
- `concepts/cloudwatch-logs.md`: "4. Where in our code" gains `log-queries.ts`.
- `concept-map.md`: "Observability" rows for structured logs, correlation ids, metrics and alerting
  point at the P2 code.
- `ROADMAP.md`, `PENDING.md`: status line and the P2 entry (no entry needed on their own).

---

## 2026-10-15 · feat(jobs): booking emails on AWS: SQS + DLQ, worker Lambda, DynamoDB, SES; pnpm stack:check (series 2, P1 = S1c)

Commit: 44e2c93

Why: Series 2, phase P1 (S1c): the job pipeline runs on AWS. The series asks for `@concept` anchors
on new code with stub cards allowed, so 5 stub cards are added and 7 cards gain an anchor line. Also
`pnpm run doctor` is renamed to `pnpm stack:check` (pnpm's built-in `doctor` shadowed it), so every
handbook page that named it changes. `pnpm docs:history --since 83f2ff3` lists the files below.

- `concepts/sqs.md`, `concepts/dead-letter-queue.md`, `concepts/aws-lambda.md`, `concepts/dynamodb.md`,
  `concepts/ses-email.md`: NEW 📋 stub cards ("1. In one line", "4. Where in our code", "Where it
  appears in the story" not linked yet); written in full in the D3 catch-up.
- `concepts/arm64-graviton.md`, `cloudwatch-logs.md`, `docker-layer-caching.md`,
  `docker-multi-stage.md`, `idempotency.md`, `least-privilege.md`, `retry-policy.md`: "4. Where in our
  code" gains the S1c anchor (worker Lambda, worker Dockerfile, processed-jobs table, worker role,
  backoff via ChangeMessageVisibility).
- `concepts/health-checks.md`, `concepts/twelve-factor-config.md`: "4. Where in our code" says
  `pnpm stack:check` (renamed).
- `concept-map.md`: "Async & Events" intro + the queue and DLQ rows point at the stub cards; "AWS
  Compute" gains Lambda and SES rows, "AWS Data" a DynamoDB row (docs:check needs every card linked).
- `prompts/series-2.md`: "Rules for every phase" and "P0" say `pnpm stack:check`.
- `ROADMAP.md`: status lines only (P1 built, waits for its first CD deploy; next P2).
- `PENDING.md`: the P1 entry; the P0 entry's file names and "unsure (1)" updated for the rename.

---

## 2026-10-15 · feat(dev): local stack health: pnpm run doctor, pnpm dev sets up the stack, pnpm stack:reset (series 2, P0)

Commit: 83f2ff3

Why: Series 2, phase P0. The series asks for `@concept` anchors on new code, so two cards gain an
anchor line; the series prompt gets its missing history line (`docs:check` failed on it since
98c1ed1) and says `pnpm run doctor`, because plain `pnpm doctor` is pnpm's own built-in command.
`pnpm docs:history --since 98c1ed1` lists the files below.

- `concepts/health-checks.md`: "4. Where in our code" gains `scripts/stack/data-checks.ts`
  (`checkPostgres`, `checkRedis`: the laptop's readiness checks).
- `concepts/twelve-factor-config.md`: "4. Where in our code" gains `scripts/stack/env-checks.ts`
  (the env files checked against their `.env.example`, values never printed).
- `prompts/series-2.md`: history line under the title; "Rules for every phase" and "P0" say
  `pnpm run doctor` (why: a built-in wins over a script and prints nothing).
- `ROADMAP.md`: status lines only (S1b done; series 2 sets the order; P0 done, P1 = S1c next).
- `PENDING.md`: the P0 entry.

---

## 2026-10-14 · feat(bookings): book a ticket + My tickets, row-locked booking transaction, race demo

Commit: e7a3965

Why: Feature 2 starts, and the owner changed the plan: the ticketing + serverless series (F2a, F2b,
S1-S4) comes next, with all handbook, guide and explorer writing batched until after it. Only the
roadmap, the prompt files and PENDING.md change in the handbook during the series. The two entries
below were committed together in 567e341; their placeholders now hold that hash.
`pnpm docs:history --since 567e341` lists the files below.

- `ROADMAP.md`: diagram redrawn (Feature 2 now, then serverless, then the guide + explorer batch);
  "Where things stand now" gains F2a in progress and the series rule; "Next, in order" replaced by
  the series (F2a … S4, then the guide + explorer v2 batch; optional later items); the handbook
  catch-up moved to "Later, not scheduled yet"; intro says the status is updated every step.
- `prompts/f2a.md`: new page, the F2a prompt word for word (prompts are kept one file per step).
- `PENDING.md`: the F2a entry.

## 2026-10-14 · docs: AGENTS.md for other coding agents + handbook roadmap

Commit: 567e341

Why: the owner wants to continue with another coding agent (OpenAI Codex) under the same rules, and
needs one page that shows the whole plan. `AGENTS.md` (repo root, outside the handbook) points to
`CLAUDE.md` and writes the safety rules out, because other agents don't read
`.claude/settings.json`. Docs only; no code, infra or behaviour change.

- `ROADMAP.md`: new page. Done (by area, with where each step is explained), where things stand
  now (CloudFront waiting, HTTPS on the ALB, manual Cloudflare CNAME, switches by commit, immutable
  OIDC subjects), next in order (Explorer v2, S1a-S1d, S2a-S2b, S3, guide chapters, catch-up,
  Feature 2), known small fixes for the catch-up.
- `README.md`: "The files" lists `ROADMAP.md`.

## 2026-10-14 · docs(guides): infra build-along (chapters 0-2) + interactive city explorer; guides/ folder

Commit: 567e341

Why: the owner knows the app but not AWS, and finds the infra code too big and the reference pages
dry. This starts a beginner's guide that moves the app from the laptop to AWS one piece at a time, as
one growing "city" map, with every setting traced from the code to the console and the CLI, plus an
interactive explorer of the same map. First round: chapters 0-2 (laptop, AWS basics, the VPC network).
Teaching guides now live in `guides/` (the "no standalone story" rule is about request-path stories),
and a living guide rule keeps the guide and explorer in step with every infra change. Docs, the
`docs:check` script and one comment line in `cd.yml` only; no infra or app behaviour change. The
previous entry's placeholder was replaced with its real hash. `pnpm docs:history --since 6ea9575`
lists the files below.

- `guides/infra-build-along.md`: new page. The city table; chapter 0 (the app on my laptop, the
  laptop → AWS table, Reach / Allowed / Password), chapter 1 (account, region, AZs, tags and names,
  Pulumi preview → up → state → outputs, the switches and their cost, the budget), chapter 2 (VPC,
  CIDR, four subnets in two AZs, internet gateway, route tables and associations, what "public" really
  means, why no NAT, default NACL and main route table); each with the same 13 parts; "Map so far"
  with real console names and IDs; "Coming next" (chapters 3-15).
- `guides/infra-explorer.html`: new page. One self-contained HTML file; the map is drawn from one
  JSON block (chapters, filters, decor, components, connections). Chapter stepper, planned parts as
  pencil outlines, details panel, connection filters, search, zoom, light and dark.
- `guides/cicd-story.md`: moved from `cicd-story.md` (guides live in `guides/` now); relative links
  fixed. Content unchanged.
- `README.md`: "The files" lists the three guides; "First full read" and "AWS round" start with the
  build-along; "Keeping it true" lists checks 7 and 8; new section "Guides: `guides/`".
- `HANDBOOK_SPEC.md`: story placement rules (guides allowed under `guides/`, what docs:check enforces
  for them); new LIVING GUIDE RULE; `guides/` in "Files and what each contains".
- `glossary.md`: new words from the guide (association, AZ ID, auto-assign public IPv4, bit,
  blackhole, cost allocation tag, Cost Explorer, default route / security group / VPC, Docker volume,
  explorer, guide, IPv4, packet, public IP address, Pulumi Cloud, resource map, stack output, tag, Tag
  Editor).

## 2026-10-14 · docs(cicd): beginner's CI/CD story + plain-English chapter comments in cd.yml

Commit: 6ea9575

Why: `cd.yml` (Steps 12a, 12b) is hard to follow for someone who has never seen GitHub Actions, bash
or Pulumi. This adds one beginner's guide to the whole pipeline, with real snippets from `ci.yml` and
`cd.yml`. Comments and docs only, no behaviour change. The previous entry's placeholder was replaced
with its real hash. `pnpm docs:history --since cc89b49` lists the files below (PENDING.md also shows
up there, from the feature steps since then; it is not changed by this commit).

- `cicd-story.md`: new page. Part 1 the story (characters table, chapters 1-11 from push to rollback,
  each with what / why / if it fails; diagrams of the whole flow, phase A/B and failures); Part 2 the
  workflow syntax (triggers, jobs, steps, runners, uses/run, with/env, expressions and script
  injection, if, needs, outputs, secrets vs vars, permissions, concurrency, environment,
  workflow_run vs workflow_dispatch); Part 3 the bash we use; Part 4 the AWS and Pulumi commands;
  Part 5 four line-by-line walk-throughs; Part 6 FAQ; Part 7 interview.
- `README.md`: "The files" table and the "First full read" path link the new page.

## 2026-10-12 · feat(events): cache-aside for events.list in Redis, with graceful degradation

Commit: cc89b49

Why: Feature 1, step 4 puts Redis in front of the `events.list` query. The handbook must explain
cache-aside, TTL with jitter, versioned keys, staleness (and why booking is not affected) and what happens
when Redis fails, tied to the new code. The previous entry's placeholder was replaced with its real hash.
`pnpm docs:history --since 121f77b` lists the files and headings below.

- `concepts/cache-aside.md`: new card (✅). The three steps, hit/miss diagrams, staleness, trade-offs;
  invalidation and stampede named as next steps (📋).
- `concepts/cache-key-versioning.md`: new card (✅). Why `events:upcoming:v1`, what bumping does.
- `concepts/graceful-degradation.md`: new card (✅). Fail open, the 100 ms deadline, not writing after an error.
- `concepts/ttl.md`: new "second TTL" (cache TTL with jitter), anchors in `events.ts` and `events-cache.ts`.
- `concepts/fail-fast.md`: step 5 added (a per-call deadline for a slow Redis), new anchor.
- `concepts/unit-tests.md`: two new anchors and table rows (events service and events-cache tests).
- `app-story.md`: chapter 10b: cache-aside diagrams (hit / miss / Redis down), code list, settings,
  measured miss vs hit, trade-offs, alternatives (invalidation, stampede as next steps), failure modes,
  interview answers, status.
- `concept-map.md`: new rows `cache-aside` (📖 → ✅), `cache-key-versioning`, `graceful-degradation`;
  `cache-invalidation` and `cache-stampede` 📖 → 📋; `ttl` and `fail-fast` rows list the new anchors.
- `00-big-picture.md`: intro, Valkey box, laptop diagram, the "public request" paragraph and the
  components table mention the events cache.
- `decisions/0002-events-cache-aside-fail-open.md`: new ADR (logic in the service, fail open, skip the write after an error).
- `glossary.md`: new Cache invalidation (server), Cache key version, Graceful degradation, Staleness (server cache);
  Cache-aside, Cache hit/miss, Cache stampede, Fail fast, Jitter, Timeout, TTL updated.

---

## 2026-10-12 · feat(events): index on events.starts_at, EXPLAIN ANALYZE explained

Commit: 121f77b

Why: Feature 1, step 3 adds the first non-key index (`events_starts_at_idx`) after the no-index
baseline of steps 21 and 22, so the handbook must explain B-tree indexes properly and teach how to
read query plans. No timings are recorded: the cards give commands, and every reader runs them to see
their own numbers. Code changes in this commit only add the index and `@concept` anchors.

- `concepts/indexing.md`: rewritten (🟡 → ✅). New: B-tree picture and Seq Scan vs Index Scan diagram,
  anchors for `events.ts` and `listUpcoming`, costs of indexes and when not to add one, why Postgres
  ignores an index, production `CREATE INDEX CONCURRENTLY` (not allowed in a transaction, drizzle's
  migrator uses one, invalid indexes), composite (📖), partial (📖) and keyset vs OFFSET (📋), 3-level
  interview answers.
- `concepts/explain-analyze.md`: new card (📖 explain-only): plan as a tree, a line-by-line table for
  reading `EXPLAIN` output, the "Try it yourself" runbook (200 000 rows with `generate_series`, before
  and after, drop and recreate the index, reset), why a small table keeps a Seq Scan.
- `app-story.md`: chapter 10b: sequence diagram note, code list (migration), cards, settings (the
  index and why plain `CREATE INDEX`), trade-offs, alternatives, failure modes, interview answers,
  status. The measured table is explicitly marked as taken before the index.
- `concept-map.md`: `indexing` row 🟡 → ✅ with the new anchors; new `explain-analyze` row (📖);
  pagination row points to the keyset explanation.
- `00-big-picture.md`: intro and the RDS box mention the `starts_at` index.
- `glossary.md`: Buffers (EXPLAIN), Composite index, CREATE INDEX CONCURRENTLY, generate_series,
  HOT update, Index Scan, Invalid index, Keyset pagination, OFFSET, Partial index, Planner,
  Selectivity, Top-N heapsort; B-tree index and EXPLAIN entries updated.

---

## 2026-10-12 · feat(events): render /events on the server with streaming, CSR vs SSR measured

Commit: 34d3d0b

Why: Feature 1, step 2 renders `/events` on the web server (prefetch + dehydrate +
`HydrationBoundary`, `<Suspense>` streaming, `error.tsx`, a server-only `API_INTERNAL_URL`) and
measures it against the Step 21 client-rendered baseline. The handbook must show both paths, the new
concepts, and that SSR does not work on AWS yet. Code changes in this commit add `@concept` anchors
next to the new code.

- `app-story.md`: chapter "10b. Reading events" rewritten for both paths (two diagrams: CSR vs SSR
  side by side, and the SSR sequence browser → web server → api → Postgres → HTML stream → hydrate),
  measured table, new cards linked; intro paragraph mentions server rendering.
- `infra-story.md`: chapter 4 (ECS), sections 9 and 16: the planned web → api path (Service
  Connect), why it is blocked today, with a diagram.
- `00-big-picture.md`: both system diagrams show the web → api call (planned on AWS); new row in the
  laptop vs AWS table; "The life of one request" explains the server-rendered public request.
- `concept-map.md`: new rows `streaming-suspense` (✅), `hydration` (✅), `server-to-server-calls` (🟡),
  `service-connect` (📋); `csr-vs-ssr` row updated (CSR ✅, SSR ✅ locally, AWS 🟡); UI errors and
  config validation rows name the new files; "Rendering strategies" row narrowed to SSG/ISR.
- `concepts/csr-vs-ssr.md`: rewritten for both paths with the measured CSR vs SSR numbers; anchors
  moved (event-card.tsx no longer holds one; page.tsx, prefetch-events.ts and events.spec.ts do).
- `concepts/hydration.md`, `concepts/streaming-suspense.md`, `concepts/server-to-server-calls.md`,
  `concepts/service-connect.md` (📋, AWS Compute): new cards.
- `concepts/server-client-components.md`: async Server Components that fetch, the events page tree
  (diagram), updated Client Component list (9 files), story link to 10b.
- `concepts/tanstack-query.md`: the events example now explains server prefetch and `staleTime`;
  the old e2e retry claim was replaced (that test is gone).
- `concepts/ui-error-handling.md`: `app/events/error.tsx` (error boundary, digest, `retry()`), step 7.
- `concepts/config-validation.md`: the web server's `getServerEnv` (lazy, throws instead of exiting).
- `concepts/end-to-end-types.md`, `concepts/app-router.md`: one "Anchor:" line each for the new code.
- `decisions/0001-ssr-calls-api-over-http.md`: first ADR file (the README plans `decisions/` for
  Phase 4): HTTP vs in-process vs direct DB, degrade to CSR vs fail, required setting.
- `glossary.md`: API_INTERNAL_URL, Async Server Component, cache() (React), Clock skew, Cloud Map,
  CLS, Dehydrate / hydrate, Digest (Next.js error), Dynamic rendering, Error boundary, FCP,
  HTML-limited bot, Hydration mismatch, HydrationBoundary, Internal ALB, LCP, Lighthouse, Median,
  Prefetch, Server-to-server call, Service Connect, Service discovery, Sidecar, staleTime, Streaming,
  Suspense, TTFB, useSyncExternalStore; CSR, SSR, Skeleton and Hydration entries updated.

---

## 2026-10-12 · feat(events): events list, read path baseline (no caching)

Commit: be8523a

Why: Feature 1, step 1 adds the first public read path (`/events`). The handbook must explain it,
and the new code needs anchors and cards. Handbook files only; code changes only add comments.

- `app-story.md`: new chapter "10b. Reading events" on the main path (browser → hook → tRPC →
  procedure → service → query → Postgres), with the measured no-cache baseline; intro paragraph
  mentions it. Numbered 10b so chapters 11-16 and their links keep their numbers.
- `00-big-picture.md`: intro and the RDS box now mention `events`; "The life of one request" notes the
  public request.
- `concept-map.md`: new rows `csr-vs-ssr` (🟡), `db-check-constraints` (✅), `seed-data` (✅); the Data,
  Frontend and TanStack Query rows mention the events files; Indexes row says `events` has none yet.
- `concepts/csr-vs-ssr.md`, `concepts/db-check-constraints.md`, `concepts/seed-data.md`: new cards.
- `concepts/tanstack-query.md`: events hook added as a second example (section 4, anchor, story link).
- `concepts/indexing.md`: `events` has no index yet, to be measured later (section 4, story link).
- `concepts/app-router.md`, `drizzle-schema.md`, `feature-folders.md`, `idempotency.md`,
  `layered-api.md`, `ui-error-handling.md`, `unit-tests.md`, `validation-at-boundaries.md`: one new
  "Anchor:" line each in section 4 for the new code (`docs:check` requires it).
- `glossary.md`: Baseline, CHECK constraint, CSR, Seed data, Skeleton, SSR.

---

## 2026-10-12 · docs(handbook): story placement rules + comment fixes

Commit: 4a91352

Why: every concept should be findable from the story, and `docs:check` should keep it that way.
Also two code comments (comment-only changes) said more than we know.

- `HANDBOOK_SPEC.md`: added the "Where it appears in the story" heading to the card structure, the
  living-handbook list, and a new "Story placement rules" section (where features go, side paths,
  no standalone story file, what `docs:check` enforces).
- `00-big-picture.md`: new section "4. Components", a table of every ✅ AWS resource with its card
  (needed by the new `docs:check` rule).
- `app-story.md`: chapter 4 now links `correlation-ids`; "The app security story" table links `csrf`
  and `xss`. Why: these three cards were not linked from any chapter.
- `concepts/*.md` (all 107 cards): new last heading "Where it appears in the story" with links to
  the exact chapters. Why: the new placement rule.
- `concepts/user-enumeration.md`: section 4, the timing note now quotes the corrected code comment
  ("about 10 ms measured on a dev laptop"). Why: the old "~50 ms" was never measured.

Code changes in the same commit (comments only): `infra/src/entry/target-groups.ts` (draining before
SIGTERM is confirmed for normal deploys, not documented for Spot interruptions),
`apps/api/src/services/auth.ts` (login timing comment), `scripts/check-concepts.ts` (check 7),
`CLAUDE.md` (story placement rule).

---

## 2026-10-12 · docs(handbook): app story + app cards + change tracking

Commit: 97f9cab

Why: Phase 3 of [HANDBOOK_SPEC.md](HANDBOOK_SPEC.md) (the app story, plus cards and `@concept`
anchors for every ✅ and 🟡 app concept); change tracking for the handbook (this file,
`pnpm docs:history`, the history line on every page); and five Phase 2 facts checked against AWS,
Next.js and Fastify docs. Code changes in the same commit: 128 anchor comment lines (no behaviour
change), `scripts/handbook-history.ts`, check 6 in `scripts/check-concepts.ts`, `CLAUDE.md` rule.

- `CHANGELOG.md`: new. This file; backfilled entries for the three earlier handbook commits.
- `app-story.md`: new. Chapters 1-16 (browser → Next.js → TanStack Query → tRPC client → Fastify
  → context → middleware → procedure → service → query → Postgres/Redis → error path; monorepo,
  validation, testing pyramid, Docker, CI), The app security story, What we'd change for
  production, How this connects. Why: Phase 3.
- `concepts/accessible-forms.md`: new card (Forms: shared-schema validation, accessible errors, focus), headings 1-10 and 13-16. Why: Phase 3 ✅/🟡 app concept.
- `concepts/app-router.md`: new card (App Router: file-based routing), headings 1-10 and 13-16. Why: Phase 3 ✅/🟡 app concept.
- `concepts/authn-vs-authz.md`: new card (Authentication vs authorization), headings 1-10 and 13-16. Why: Phase 3 ✅/🟡 app concept.
- `concepts/ci-pipeline.md`: new card (CI pipeline: quality, e2e and docker jobs), headings 1-10 and 13-16. Why: Phase 3 ✅/🟡 app concept.
- `concepts/config-validation.md`: new card (Config validation: fail fast at startup), headings 1-10 and 13-16. Why: Phase 3 ✅/🟡 app concept.
- `concepts/connection-pooling.md`: new card (Connection pooling), headings 1-10 and 13-16. Why: Phase 3 ✅/🟡 app concept.
- `concepts/container-hardening.md`: new card (Container hardening: non-root, slim, production-only deps), headings 1-10 and 13-16. Why: Phase 3 ✅/🟡 app concept.
- `concepts/correlation-ids.md`: new card (Request IDs and correlation IDs), headings 1-10 and 13-16. Why: Phase 3 ✅/🟡 app concept.
- `concepts/cors.md`: new card (CORS), headings 1-10 and 13-16. Why: Phase 3 ✅/🟡 app concept.
- `concepts/csrf.md`: new card (CSRF (cross-site request forgery)), headings 1-10 and 13-16. Why: Phase 3 ✅/🟡 app concept.
- `concepts/docker-layer-caching.md`: new card (Docker layer caching), headings 1-10 and 13-16. Why: Phase 3 ✅/🟡 app concept.
- `concepts/docker-multi-stage.md`: new card (Docker multi-stage builds (and Next.js standalone)), headings 1-10 and 13-16. Why: Phase 3 ✅/🟡 app concept.
- `concepts/drizzle-schema.md`: new card (Postgres schema with Drizzle ORM (UUID keys)), headings 1-10 and 13-16. Why: Phase 3 ✅/🟡 app concept.
- `concepts/e2e-tests.md`: new card (End-to-end tests with Playwright (and test data isolation)), headings 1-10 and 13-16. Why: Phase 3 ✅/🟡 app concept.
- `concepts/end-to-end-types.md`: new card (End-to-end types: web imports only `type AppRouter`), headings 1-10 and 13-16. Why: Phase 3 ✅/🟡 app concept.
- `concepts/error-handling.md`: new card (Central error handling: business error → HTTP status), headings 1-10 and 13-16. Why: Phase 3 ✅/🟡 app concept.
- `concepts/fail-fast.md`: new card (Fail fast and timeouts when a dependency is down), headings 1-10 and 13-16. Why: Phase 3 ✅/🟡 app concept.
- `concepts/fastify-app.md`: new card (Fastify app: "build" apart from "listen"), headings 1-10 and 13-16. Why: Phase 3 ✅/🟡 app concept.
- `concepts/feature-folders.md`: new card (Feature folders: components use hooks, never tRPC), headings 1-10 and 13-16. Why: Phase 3 ✅/🟡 app concept.
- `concepts/graceful-shutdown.md`: new card (Graceful shutdown (and PID 1 signals)), headings 1-10 and 13-16. Why: Phase 3 ✅/🟡 app concept.
- `concepts/health-checks.md`: new card (Health checks: liveness vs readiness), headings 1-10 and 13-16. Why: Phase 3 ✅/🟡 app concept.
- `concepts/http-status-codes.md`: new card (HTTP methods and status codes), headings 1-10 and 13-16. Why: Phase 3 ✅/🟡 app concept.
- `concepts/idempotency.md`: new card (Idempotency), headings 1-10 and 13-16. Why: Phase 3 ✅/🟡 app concept.
- `concepts/in-process-api-tests.md`: new card (In-process API tests (no real network)), headings 1-10 and 13-16. Why: Phase 3 ✅/🟡 app concept.
- `concepts/indexing.md`: new card (Indexes (B-tree)), headings 1-10 and 13-16. Why: Phase 3 ✅/🟡 app concept.
- `concepts/layered-api.md`: new card (Layered architecture: procedures → services → queries), headings 1-10 and 13-16. Why: Phase 3 ✅/🟡 app concept.
- `concepts/log-redaction.md`: new card (Log redaction: no passwords in logs), headings 1-10 and 13-16. Why: Phase 3 ✅/🟡 app concept.
- `concepts/migrations.md`: new card (SQL migrations: generate, apply, one-off runner), headings 1-10 and 13-16. Why: Phase 3 ✅/🟡 app concept.
- `concepts/monolith-vs-microservices.md`: new card (Monolith vs microservices), headings 1-10 and 13-16. Why: Phase 3 ✅/🟡 app concept.
- `concepts/monorepo.md`: new card (Monorepo with pnpm workspaces, shared package), headings 1-10 and 13-16. Why: Phase 3 ✅/🟡 app concept.
- `concepts/open-redirect.md`: new card (Open redirect protection), headings 1-10 and 13-16. Why: Phase 3 ✅/🟡 app concept.
- `concepts/password-hashing.md`: new card (Password hashing with argon2id), headings 1-10 and 13-16. Why: Phase 3 ✅/🟡 app concept.
- `concepts/protected-procedure.md`: new card (Protected procedures: the real auth check), headings 1-10 and 13-16. Why: Phase 3 ✅/🟡 app concept.
- `concepts/query-invalidation.md`: new card (Cache invalidation after a mutation), headings 1-10 and 13-16. Why: Phase 3 ✅/🟡 app concept.
- `concepts/retry-policy.md`: new card (Retry policy: retry only what is safe), headings 1-10 and 13-16. Why: Phase 3 ✅/🟡 app concept.
- `concepts/route-guard-proxy.md`: new card (Route guard in the Next.js proxy (UX only, not security)), headings 1-10 and 13-16. Why: Phase 3 ✅/🟡 app concept.
- `concepts/rpc-vs-rest.md`: new card (RPC vs REST (why tRPC)), headings 1-10 and 13-16. Why: Phase 3 ✅/🟡 app concept.
- `concepts/server-client-components.md`: new card (Server Components vs Client Components), headings 1-10 and 13-16. Why: Phase 3 ✅/🟡 app concept.
- `concepts/session-cookie.md`: new card (Session cookie flags: HttpOnly, SameSite, Secure), headings 1-10 and 13-16. Why: Phase 3 ✅/🟡 app concept.
- `concepts/sessions-vs-jwt.md`: new card (Server-side sessions in Redis vs JWT (and logout)), headings 1-10 and 13-16. Why: Phase 3 ✅/🟡 app concept.
- `concepts/sql-injection.md`: new card (SQL injection: parameterized queries), headings 1-10 and 13-16. Why: Phase 3 ✅/🟡 app concept.
- `concepts/sql-vs-nosql.md`: new card (SQL vs NoSQL), headings 1-10 and 13-16. Why: Phase 3 ✅/🟡 app concept.
- `concepts/state-management.md`: new card (Client state vs server state), headings 1-10 and 13-16. Why: Phase 3 ✅/🟡 app concept.
- `concepts/stateless-servers.md`: new card (Stateless API servers), headings 1-10 and 13-16. Why: Phase 3 ✅/🟡 app concept.
- `concepts/static-checks.md`: new card (Static checks: strict TypeScript + lint), headings 1-10 and 13-16. Why: Phase 3 ✅/🟡 app concept.
- `concepts/structured-logging.md`: new card (Structured JSON logs (Fastify's logger, pino)), headings 1-10 and 13-16. Why: Phase 3 ✅/🟡 app concept.
- `concepts/tailwind.md`: new card (Tailwind CSS (utility classes)), headings 1-10 and 13-16. Why: Phase 3 ✅/🟡 app concept.
- `concepts/tanstack-query.md`: new card (TanStack Query: the server-state cache), headings 1-10 and 13-16. Why: Phase 3 ✅/🟡 app concept.
- `concepts/testing-pyramid.md`: new card (Testing pyramid), headings 1-10 and 13-16. Why: Phase 3 ✅/🟡 app concept.
- `concepts/trpc-client.md`: new card (tRPC client and request batching), headings 1-10 and 13-16. Why: Phase 3 ✅/🟡 app concept.
- `concepts/trpc-context.md`: new card (tRPC context, built once per request), headings 1-10 and 13-16. Why: Phase 3 ✅/🟡 app concept.
- `concepts/trpc-middleware.md`: new card (tRPC middleware chain), headings 1-10 and 13-16. Why: Phase 3 ✅/🟡 app concept.
- `concepts/trust-proxy.md`: new card (Reverse proxies and `X-Forwarded-For` (`trustProxy`)), headings 1-10 and 13-16. Why: Phase 3 ✅/🟡 app concept.
- `concepts/ttl.md`: new card (TTL (time to live)), headings 1-10 and 13-16. Why: Phase 3 ✅/🟡 app concept.
- `concepts/twelve-factor-config.md`: new card (Config from the environment (12-factor), build time vs run time), headings 1-10 and 13-16. Why: Phase 3 ✅/🟡 app concept.
- `concepts/ui-error-handling.md`: new card (Showing API errors in the UI (field errors, 401 redirect)), headings 1-10 and 13-16. Why: Phase 3 ✅/🟡 app concept.
- `concepts/unique-constraint-race.md`: new card (Unique constraint vs check-then-insert (race condition)), headings 1-10 and 13-16. Why: Phase 3 ✅/🟡 app concept.
- `concepts/unit-tests.md`: new card (Unit tests (Vitest, next to the code)), headings 1-10 and 13-16. Why: Phase 3 ✅/🟡 app concept.
- `concepts/user-enumeration.md`: new card (User enumeration: equal timing, one error message), headings 1-10 and 13-16. Why: Phase 3 ✅/🟡 app concept.
- `concepts/validation-at-boundaries.md`: new card (Validation at boundaries: input and output schemas), headings 1-10 and 13-16. Why: Phase 3 ✅/🟡 app concept.
- `concepts/xss.md`: new card (XSS (cross-site scripting)), headings 1-10 and 13-16. Why: Phase 3 ✅/🟡 app concept.
- `concepts/image-scanning.md`: 4. Where in our code, 8, 9, 13, 14, 15, 16. Why: basic scan =
  OS packages only, at push (verified from AWS docs); npm dependency scanning (Inspector enhanced
  scanning or Trivy in CI) added to "to make it production-grade".
- `concepts/circuit-breaker.md`: 4. Where in our code, 7. Our settings and WHY (threshold table),
  13, 14. Why: threshold = 50% of desired count, min 3, max 200 (verified from AWS docs); 3 for us.
- `concepts/compression.md`: 4. Where in our code, 14. Why: Next.js gzips by default (verified in
  the Next.js docs and in the installed Next.js 16.4.0 source for the standalone server).
- `concepts/http-versions.md`: 3. Picture it, 4, 8, 13, 14, 15. Why: CloudFront → custom origin is
  always HTTP/1.1 (verified from AWS docs).
- `concepts/zero-downtime-deploys.md`: 4. Where in our code (new sub-section "Planned improvement:
  wait a few seconds after SIGTERM before closing"), 14, 16. Why: draining-then-SIGTERM order
  verified for normal stops; on Spot, SIGTERM may come before routing stops.
- `concepts/fargate-spot.md`: 4. Where in our code. Why: Spot SIGTERM vs draining, linked to the
  planned wait.
- `concept-map.md`: Frontend, API, Data, Auth & Security, Performance & Caching, Reliability,
  DevOps & CI/CD, Observability, Testing. Why: link the 61 Phase 3 cards; fail-fast ✅ → 🟡
  (Postgres has no connection timeout); graceful-shutdown notes the planned wait.
- `README.md`: The files, Reading paths (new Backend round; links in Security and Frontend rounds),
  Keeping it true (check 6), Change history (new section). Why: app story and change tracking.
- `infra-story.md`: The deploy story (circuit-breaker threshold), The security story (link to the
  app security story), What we'd change for production (dependency scanning, wait after
  SIGTERM). Why: Part A facts and Phase 3 links.
- `00-big-picture.md`: How this connects. Why: link the app story.
- `glossary.md`: A-X. Why: 70 new words used by the app story and cards (hydration, IDOR, salt,
  liveness vs readiness, …); the Brotli/gzip entry now says verified.
- `HANDBOOK_SPEC.md`: (top of file). Why: history line under the title.
- `aws-foundations.md`: (top of file). Why: history line under the title.
- `concepts/alb.md`: (top of file). Why: history line under the title.
- `concepts/alerting.md`: (top of file). Why: history line under the title.
- `concepts/arm64-graviton.md`: (top of file). Why: history line under the title.
- `concepts/backups-dr.md`: (top of file). Why: history line under the title.
- `concepts/budget-alerts.md`: (top of file). Why: history line under the title.
- `concepts/cdn-caching.md`: (top of file). Why: history line under the title.
- `concepts/cloudfront.md`: (top of file). Why: history line under the title.
- `concepts/cloudwatch-logs.md`: (top of file). Why: history line under the title.
- `concepts/cost-switches.md`: (top of file). Why: history line under the title.
- `concepts/ecr.md`: (top of file). Why: history line under the title.
- `concepts/ecs-cluster.md`: (top of file). Why: history line under the title.
- `concepts/ecs-exec.md`: (top of file). Why: history line under the title.
- `concepts/ecs-service.md`: (top of file). Why: history line under the title.
- `concepts/elasticache-valkey.md`: (top of file). Why: history line under the title.
- `concepts/encryption-at-rest.md`: (top of file). Why: history line under the title.
- `concepts/execution-vs-task-role.md`: (top of file). Why: history line under the title.
- `concepts/fargate.md`: (top of file). Why: history line under the title.
- `concepts/high-availability.md`: (top of file). Why: history line under the title.
- `concepts/immutable-image-tags.md`: (top of file). Why: history line under the title.
- `concepts/infrastructure-as-code.md`: (top of file). Why: history line under the title.
- `concepts/kms.md`: (top of file). Why: history line under the title.
- `concepts/least-privilege.md`: (top of file). Why: history line under the title.
- `concepts/load-balancing-algorithms.md`: (top of file). Why: history line under the title.
- `concepts/metrics.md`: (top of file). Why: history line under the title.
- `concepts/origin-protection.md`: (top of file). Why: history line under the title.
- `concepts/rds-managed-password.md`: (top of file). Why: history line under the title.
- `concepts/rds-postgres.md`: (top of file). Why: history line under the title.
- `concepts/regions-and-azs.md`: (top of file). Why: history line under the title.
- `concepts/route-tables.md`: (top of file). Why: history line under the title.
- `concepts/same-origin-routing.md`: (top of file). Why: history line under the title.
- `concepts/scaling.md`: (top of file). Why: history line under the title.
- `concepts/secrets-management.md`: (top of file). Why: history line under the title.
- `concepts/secrets-manager.md`: (top of file). Why: history line under the title.
- `concepts/security-groups.md`: (top of file). Why: history line under the title.
- `concepts/subnets.md`: (top of file). Why: history line under the title.
- `concepts/target-groups.md`: (top of file). Why: history line under the title.
- `concepts/task-definition.md`: (top of file). Why: history line under the title.
- `concepts/tls-in-transit.md`: (top of file). Why: history line under the title.
- `concepts/tls-termination.md`: (top of file). Why: history line under the title.
- `concepts/vpc.md`: (top of file). Why: history line under the title.
- `reference-topics.md`: (top of file). Why: history line under the title.

Every page above also got the history line under its title.

---

## 2026-10-11 · docs(handbook): infra story + aws cards

Commit: eb316d9

Why: Phase 2 of [HANDBOOK_SPEC.md](HANDBOOK_SPEC.md): the infra story and cards + anchors for every
✅ and 🟡 AWS concept. (The anchors in `infra/` and the apps were added in the same commit.)

- `infra-story.md`: new. Chapters 1. CloudFront … 14. Pulumi and the switches, The deploy story, The
  security story, The cost story, What we'd change for production, How this connects.
- `concepts/alb.md`: new card (Application Load Balancer, listener, default 403), 16 headings.
- `concepts/alerting.md`: new card (Alerting), 16 headings.
- `concepts/arm64-graviton.md`: new card (ARM64 (Graviton) images and tasks), 16 headings.
- `concepts/backups-dr.md`: new card (Backups, snapshots, disaster recovery), 16 headings.
- `concepts/budget-alerts.md`: new card (Budget alerts), 16 headings.
- `concepts/cdn-caching.md`: new card (CDN caching: hashed static files cached, per-user answers never), 16 headings.
- `concepts/circuit-breaker.md`: new card (Circuit breaker), 16 headings.
- `concepts/cloudfront.md`: new card (CloudFront: CDN and HTTPS), 16 headings.
- `concepts/cloudwatch-logs.md`: new card (CloudWatch Logs: log groups, streams, retention), 16 headings.
- `concepts/compression.md`: new card (Compression at the edge (gzip / Brotli)), 16 headings.
- `concepts/cost-switches.md`: new card (Cost on/off switches), 16 headings.
- `concepts/ecr.md`: new card (ECR: the image registry), 16 headings.
- `concepts/ecs-cluster.md`: new card (ECS cluster and capacity providers), 16 headings.
- `concepts/ecs-exec.md`: new card (ECS Exec: a shell inside a running task), 16 headings.
- `concepts/ecs-service.md`: new card (ECS service: desired count, replacement), 16 headings.
- `concepts/elasticache-valkey.md`: new card (ElastiCache Valkey: TLS + auth token), 16 headings.
- `concepts/encryption-at-rest.md`: new card (Encryption at rest), 16 headings.
- `concepts/execution-vs-task-role.md`: new card (Execution role vs task role), 16 headings.
- `concepts/fargate-spot.md`: new card (Fargate Spot), 16 headings.
- `concepts/fargate.md`: new card (Fargate: containers without managing servers), 16 headings.
- `concepts/high-availability.md`: new card (High availability across availability zones), 16 headings.
- `concepts/http-versions.md`: new card (HTTP/1.1 vs HTTP/2 vs HTTP/3), 16 headings.
- `concepts/image-scanning.md`: new card (Image vulnerability scanning), 16 headings.
- `concepts/immutable-image-tags.md`: new card (Immutable image tags (git SHA)), 16 headings.
- `concepts/infrastructure-as-code.md`: new card (Infrastructure as Code with Pulumi), 16 headings.
- `concepts/kms.md`: new card (KMS keys (AWS-managed)), 16 headings.
- `concepts/least-privilege.md`: new card (Least privilege), 16 headings.
- `concepts/load-balancing-algorithms.md`: new card (Load balancing algorithms: round robin, least connections, IP hash), 16 headings.
- `concepts/metrics.md`: new card (Metrics), 16 headings.
- `concepts/origin-protection.md`: new card (Origin protection: prefix list + secret header), 16 headings.
- `concepts/rds-managed-password.md`: new card (RDS-managed master password (and the rotation limit)), 16 headings.
- `concepts/rds-postgres.md`: new card (RDS Postgres: private, single-AZ, subnet group), 16 headings.
- `concepts/regions-and-azs.md`: new card (Regions and availability zones), 16 headings.
- `concepts/route-tables.md`: new card (Route tables and the internet gateway), 16 headings.
- `concepts/same-origin-routing.md`: new card (Same-origin path routing: `/trpc/*` → api), 16 headings.
- `concepts/scaling.md`: new card (Vertical vs horizontal scaling), 16 headings.
- `concepts/secrets-management.md`: new card (Secrets management: never in code, images or state), 16 headings.
- `concepts/secrets-manager.md`: new card (Secrets Manager), 16 headings.
- `concepts/security-groups.md`: new card (Security groups: stateful, group references), 16 headings.
- `concepts/subnets.md`: new card (Public vs private subnets), 16 headings.
- `concepts/target-groups.md`: new card (Target groups and ALB health checks), 16 headings.
- `concepts/task-definition.md`: new card (Task definition: recipe, revisions, `awsvpc`), 16 headings.
- `concepts/tls-in-transit.md`: new card (Encryption in transit (TLS)), 16 headings.
- `concepts/tls-termination.md`: new card (TLS termination: where HTTPS ends), 16 headings.
- `concepts/vpc.md`: new card (VPC and CIDR blocks), 16 headings.
- `concepts/zero-downtime-deploys.md`: new card (Zero-downtime deploys: rolling update + draining), 16 headings.
- `concept-map.md`: API, Auth & Security, Performance & Caching, Reliability, DevOps & CI/CD, AWS
  Network, AWS Compute, AWS Data, Observability. Why: link the Phase 2 cards; compression ✅ → 🟡
  after checking AWS's docs.
- `README.md`: The files, Reading paths. Why: link the infra story and Phase 2 cards.
- `00-big-picture.md`: How this connects. Why: link the infra story.
- `aws-foundations.md`: 1. Regions, availability zones and accounts › 7. Our settings and WHY (how
  to choose a region: diagram, table, `ap-south-1` note); How this connects. Why: explain the
  region choice; link the infra story.
- `glossary.md`: A-I, L-M, O-T, V-X. Why: words used by the infra story and AWS cards.

---

## 2026-10-11 · docs(handbook): skeleton, concept map, aws foundations

Commit: d3c9589

Why: Phase 1 of [HANDBOOK_SPEC.md](HANDBOOK_SPEC.md). (`scripts/check-concepts.ts`, `pnpm docs:check`
and its CI step were added in the same commit.)

- `README.md`: new. The files, How to use it, Reading paths, Conventions, Keeping it true: `pnpm
  docs:check`, The living handbook rule, How this connects.
- `concept-map.md`: new. How to read the table, the 13 areas (Frontend … Testing), Topics added
  beyond reference-topics.md, How this connects.
- `00-big-picture.md`: new. 1. The whole system today, 2. The life of one request, 3. The life of a
  login request, How this connects.
- `aws-foundations.md`: new. Chapters 1-8 (regions, ARNs, Reach / Allowed / Password, IAM policies,
  roles and STS, service-to-service calls, service-linked roles, debugging checklist), How this
  connects.
- `glossary.md`: new. A-Z.

---

## 2026-10-11 · docs(handbook): spec and reference topics

Commit: 2d026b6

Why: the owner's spec for the handbook and the checklist of interview topics.

- `HANDBOOK_SPEC.md`: new. GOAL, AUDIENCE, ACCURACY RULES, WRITING RULES, CODE ANCHORS, FILES AND
  WHAT EACH CONTAINS, STRUCTURE OF EVERY CHAPTER AND EVERY CONCEPT CARD, PHASES, LIVING HANDBOOK RULE.
- `reference-topics.md`: new. APIs & protocols, Databases, Auth & security, Caching & performance,
  Async & events, Reliability & scale, Observability.

# Series 2: finish MiniTickets and teach it

History: see [CHANGELOG.md](../CHANGELOG.md) or run `pnpm docs:history`

## Goal
Finish MiniTickets so it covers the scenarios senior/lead interviews ask
about (frontend, backend, database, caching, async, AWS, security,
delivery), working locally AND on AWS. Then build documentation and an
interactive explorer so the reader can see, start to end, what exists,
where the code is, how every piece connects, how to check it in the AWS
console, and how to answer interview questions from this real code.

The reader knows the app but not AWS deeply, gets bored by dry reference
docs, and wants ONE clear picture in their head. Everything must be in
very simple English, connected, and checkable (code <-> console <-> CLI).

## How to use this file
- Each session: read CLAUDE.md, AGENTS.md, docs/handbook/ROADMAP.md and
  this file, then do ONLY the phase(s) named in the prompt. Phases are in
  dependency order. Works for any coding agent (Claude Code, Codex).
- Keep reports short: what was built, demo results (numbers), checks,
  "Not verified", manual steps for me (exact, in order), the AWS
  acceptance checklist (if infra changed), suggested commit message.
  Don't paste file contents. Don't re-read files you didn't change.

## Rules for every phase
- Follow CLAUDE.md / AGENTS.md: safety rules, layers (procedures ->
  services -> queries/queues), numbered WHAT/WHY comments, pulumi preview
  only (never up/destroy/refresh), never push.
- COMMITS (this series only): ONE local commit per phase with the
  suggested message, after all checks pass. Never push, amend or rewrite
  history. Never commit secrets or .env files.
- During build phases, no handbook/guide/explorer edits. Append to
  PENDING.md for the phase: concepts, files (path + function), infra
  changes, demo results with numbers, and "interview angles" (questions
  this phase answers, counter-questions, trade-offs, what changes at
  10x/100x). Update the ROADMAP status line. Add @concept anchors to new
  code (doc phases use them); keep docs:check passing (stub cards OK).
- Infra: IAM with WHO / WHAT / ATTACHED comments, least privilege, tags,
  idle cost stated. Update docs/20-deploy-day.md (operational runbook)
  for anything a deploy needs. End the report with an AWS acceptance
  checklist: what I check live (console path + expected result + CLI).
- CloudFront is still waiting for AWS account verification: the live
  setup is cdnEnabled=false (HTTPS on the ALB, minitickets.theversehub.in,
  Cloudflare CNAME set by hand). Everything must work in that mode.
- CD: anything that ships is built ONCE by publish (git SHA tag) and
  deployed by the deploy job via the SSM tag. The environment is turned
  on/off by committing the switches.
- Tests: unit for logic, e2e for user-visible flows, a demo script with
  printed numbers for anything about concurrency, failure or scale.
  Break the code on purpose once to prove each important test catches it.
- Local dev: the same SDK code paths as AWS, with local emulators in
  docker-compose (simplest reliable option per service; explain why).
- Finish every phase with: pnpm stack:check, typecheck, lint, unit tests, e2e
  on my servers (:3000/:4000), docs:check, actionlint (if workflows
  changed), pulumi preview (if infra changed; paste the summary).

## Build phases

### P0 Local stack health
- `pnpm stack:check` (not "doctor": `pnpm doctor` is pnpm's own
  built-in, which wins over a script and prints nothing): checks every container, env file, migration, queue,
  table and port the app needs; prints exactly what to fix.
- `pnpm dev` starts everything needed; `pnpm stack:reset` recreates local
  queues/tables/seed data (DynamoDB Local is in-memory: handle that).
- Fix the known e2e env gaps (WEB_INTERNAL_URL / REVALIDATE_SECRET):
  tell me the exact lines to add.

### P1 (S1c) Job pipeline on AWS
SQS jobs queue + DLQ (maxReceiveCount 3, visibility >= 6x Lambda
timeout, encryption on), DynamoDB processed-jobs table (on-demand, TTL),
ECR worker repo (same settings/lifecycle as api/web), worker Lambda
(container image, arm64, pick the Lambda Node runtime closest to .nvmrc
and explain, outside the VPC and why, 256 MB, timeout 10s, reserved
concurrency 5, event source mapping batch 10 + ReportBatchItemFailures,
backoff via ChangeMessageVisibility), SES domain identity
minitickets.theversehub.in with DKIM (records exported for Cloudflare) +
an email identity for my address (config sesTestRecipient; explain the
sandbox), SesMailer (local keeps LogMailer). IAM: Lambda role (receive/
delete/change visibility/get attributes on the main queue, get/put on
the table, SES send on our identity, logs); API task role + SendMessage
only; deploy + publish roles updated. CD builds/deploys the worker image
(first deploy: use the new tag if the current one has no worker image).

### P2 (S1d) Observability
- Correlation ID per API request, carried in messages, in every log line
  of API and Lambdas (follow one booking end to end).
- Structured JSON logs everywhere; CloudWatch alarms (DLQ not empty,
  Lambda errors, oldest message age, ALB 5xx); SNS alert topic emailing
  me (manual confirmation); a CloudWatch dashboard. Explain-only in
  PENDING: OpenTelemetry/X-Ray tracing, SLOs and error budgets.

### P3 Outbox pattern (no lost messages)
- outbox table written in the SAME transaction as the booking.
- Relay in the API process: SELECT ... FOR UPDATE SKIP LOCKED in small
  batches, publish, mark sent; safe with several API tasks; backoff.
- Remove the direct publish. Demo: queue down -> book -> queue back ->
  delivered; 2 API instances -> each message published once.

### P4 (S2) Tickets with QR codes + file uploads
- SNS topic for booking events; the relay publishes to SNS; SQS queues
  subscribe (email + ticket), each with its own DLQ. Note SNS vs SQS vs
  EventBridge vs Kafka (decision + trade-offs) in PENDING.
- Ticket Lambda: one ticket per seat; QR token signed with HMAC (secret
  in Secrets Manager) so tickets can't be forged; QR PNG in a PRIVATE S3
  bucket (block public access, SSE, lifecycle); ticket records in a
  DynamoDB "tickets" table (GSI by event date). Idempotent.
- API: tickets.mine with short-lived presigned GET URLs (task role: read
  only the ticket prefix + read the tickets table).
- Web: My tickets shows QR + download; "being created" state while the
  Lambda works (eventual consistency in the UI).
- Admin event poster upload: presigned PUT straight to S3 with content
  type and size limits, shown on the event page. Explain upload security
  (validation, scanning, never trusting the client).

### P5 (S3) Reminder the day before
- EventBridge Scheduler (daily) -> reminder Lambda: reads the tickets GSI
  for tomorrow (no VPC, no Postgres) -> reminder jobs on the email queue.
  Idempotent per ticket per day. Scheduler role may invoke only that
  Lambda.

### P6 (S4) Door check-in
- API Gateway REST API (usage plan, API key, throttling; why REST not
  HTTP API here) -> check-in Lambda: verify the HMAC signature, then a
  DynamoDB CONDITIONAL update valid -> used.
- /scanner page (paste or camera-scan; staff enter the API key; never in
  the bundle). Demo: 2 scans of one ticket at once -> 1 success, 1
  "already used at <time>".

### P7 Search + big lists
- Search as you type: pg_trgm GIN index, events.search with keyset
  pagination; UI debounce, cancel stale requests, keep previous results
  while loading. e2e proves an older slow response can NEVER overwrite a
  newer one.
- 10k events: bulk seed, infinite list with keyset pagination (why not
  OFFSET) + virtualization; measure DOM nodes and render time with vs
  without.
- API design notes in PENDING: pagination styles, error format, API
  versioning, tRPC vs REST vs GraphQL.

### P8 Sale day
- Rate limiting (token bucket in Redis, Lua) on login and booking; 429 +
  Retry-After.
- Redis inventory gate for hot events (atomic Lua DECRBY, instant "sold
  out", DB stays the source of truth, give back on DB failure,
  reconciliation job). Explain-only: waiting room, queue-based booking,
  seat holds with expiry.
- ECS service autoscaling (target tracking on CPU / ALB requests per
  target, min 1 max 3) with a cost note.
- Load test (autocannon or k6): one hot event, N users; throughput,
  p50/p95/p99, DB lock waits, with vs without the gate.

### P9 Real-time seat updates
- Seats left updates live on the event page via Server-Sent Events;
  Redis pub/sub so it works with several API tasks; fallback to polling.
  Explain SSE vs WebSockets vs polling, and ALB idle timeouts.

### P10 Security hardening
- CSRF Origin / Sec-Fetch-Site check on all mutations; security headers
  incl. CSP with nonces (Next.js way); session rotation on login and role
  change; "log out everywhere"; DB connection timeout + statement_timeout
  (fail-fast); CI: Trivy image scan (fail on CRITICAL) + dependency audit.

### P11 Web performance + quality
- Real Core Web Vitals (LCP, INP, CLS, TTFB, FCP) via useReportWebVitals
  -> endpoint -> structured log (CloudWatch metric filter on AWS).
- Lighthouse CI on a production build with budgets (why INP needs real
  users); bundle analysis + one measured improvement.
- Accessibility checks (axe) in e2e.

### Extras (only when I ask)
- PX1 CloudFront on (when AWS approves): cdnEnabled=true, HTTPS from
  CloudFront to the ALB with the custom domain, test the /events edge
  cache and the RSC rules live.
- PX2 Cloudflare CNAME managed by Pulumi (Cloudflare provider), so a new
  ALB updates DNS automatically.
- PX3 Pulumi Cloud OIDC for CD (remove PULUMI_ACCESS_TOKEN: the last
  long-lived secret).
- PX4 Step Functions booking payment saga (reserve -> pay -> confirm or
  release), cancel booking, waitlist.

## Documentation phases (after all build phases)

### D0 Code tours generator
- `pnpm docs:build` extracts code snippets around @concept anchors into
  the docs/explorer data, so snippets always match the code. docs:check
  fails if generated data is stale.

### D1 Infra guide + Explorer v3 (the main learning tool)
- infra-build-along.md: remaining chapters in build order, SAME format,
  city story and level of detail as chapters 0-2 (security groups,
  ENIs/public IPs, data, secrets, ECR, ECS, IAM, ALB, Service Connect,
  CloudFront, CI/CD, SQS/DLQ, Lambda, DynamoDB, SES, SNS, S3, Scheduler,
  API Gateway, alarms, autoscaling, debugging playbook, final poster).
  Every chapter: Code -> Console -> CLI table, console mission with the
  built-in visual maps, "follow one thing", Reach / Allowed / Password,
  when it breaks, interview answer, check yourself.
- infra-explorer.html v3 (self-contained, data-driven, offline):
  - Keep EVERYTHING from v1 the reader liked: city-plan map, chapter
    stepper, growing map, faint "planned" parts, side panel with code
    file + function, console path, CLI. Same detail for EVERY chapter.
  - Two linked views: INFRA MAP (the city) and CODE MAP (monorepo layers:
    component -> hook -> tRPC -> procedure -> service -> query/queue ->
    store).
  - Per-chapter "Walk me through" tour (5-10 steps in a logical order).
    Each step highlights the piece AND its connections, dims the rest,
    explains in 2-3 plain lines, then three boxes: "Check in the console"
    (exact click path + what you'll see + one question), "Check in the
    code" (file + function + exact setting + generated snippet), "CLI"
    (command + what the output means). Back / Next, progress bar,
    "I checked this" checkbox (saved locally).
  - Cross-chapter tours, same step format: infra build order; a booking
    end to end (browser -> ALB -> API -> Postgres + outbox -> SNS -> SQS
    -> Lambdas -> SES / S3 / DynamoDB -> My tickets); search as you type;
    sale day; live seats; a deploy; door check-in; a failing email
    (retry -> DLQ -> alarm); who can reach the database; every IAM badge;
    security layers.
  - The right panel follows the tour order, numbered to match: pieces in
    build order, then connections grouped by kind. No back-and-forth.
  - Focus mode (click a piece: only its connections stay bright, with
    arrows and "what allows it" labels); connection kinds (route, SG
    rule, IAM, secret, DNS, event/data flow) with colors AND line styles
    + legend; a connections table (from -> to -> kind -> what allows it
    -> where to check), filterable and searchable.
  - CONCEPT INDEX: search "DLQ", "idempotency", "row lock", "presigned
    URL", ... -> where it is in MiniTickets (component, tour step, code,
    console path, demo command, scenario link).
  - Readability as it grows: labels never overlap; long names truncate
    with the full name on hover/focus; collapsible zones; zoom/fit.
  - Data checks: docs:check fails if a label is missing ("undefined"), a
    tour step points at a missing piece, or a built piece is in no tour.
  - Verify with headless screenshots (light, dark, 1280/1024 wide, tours,
    focus mode, table); no console errors; keyboard works; beginner
    self-check.

### D2 Interview scenarios
- guides/interview-scenarios.md + interactive scenarios.html (filters by
  area and status, search, links into the explorer and code tours).
- INTERVIEW MODE: flashcards and short quizzes per area; progress saved
  locally.
- Every scenario: the question; a 30-second answer; HOW MINITICKETS DOES
  IT (code + demo command) or, if explain-only, WHERE IN MINITICKETS it
  would go and how (layer, file, diagram); a diagram; why; trade-offs and
  alternatives; what changes at 10x/100x; counter-questions with answers;
  status (built / partly / explain-only).
- Cover at least everything in PENDING.md "interview angles", plus these
  areas (add every other commonly asked scenario you know):
  frontend (search races, debounce/throttle, 10k items, SSR/CSR/static,
  hydration, Web Vitals and measuring them, bundle size, private vs
  shared page caching, optimistic UI, accessibility, real-time updates);
  API/backend (concurrent writes, lost updates, locks vs atomic UPDATE vs
  optimistic locking, idempotency, retries/backoff/jitter, timeouts,
  circuit breaker, rate limiting, N+1, pool exhaustion, graceful
  shutdown, API design, testing strategy); database (how Postgres
  caches, indexes/EXPLAIN, keyset vs OFFSET, zero-downtime migrations,
  replicas and lag, backups/PITR); caching (cache-aside, stampede,
  invalidation, SWR, stacked caches, hot keys, privacy); async (queues/
  topics/buses, at-least-once, idempotent consumers, DLQ, outbox,
  ordering, fan-out, eventual consistency, sagas); sale day; AWS (ECS vs
  Lambda vs EKS, cold starts, Lambda in/out of VPC, NAT cost, IAM, OIDC,
  SGs vs NACLs, presigned URLs, DynamoDB design, API Gateway, SES,
  multi-AZ, autoscaling, multi-region, cost); security (sessions vs JWT,
  CSRF/XSS/CORS, CSP, secrets/rotation, forged tickets, uploads, OWASP);
  delivery/ops (CI/CD, rollback with migrations, blue/green vs rolling,
  feature flags, observability, incident debugging).
- Include word for word: (1) typing "a" then "ap" in search: can the old
  response override the new one? (2) many requests at the same time: how
  does the DB handle it? (3) no cache and many requests: how to lock and
  get the latest? (4) caching Next pages that must not be shared (Next
  server, CloudFront) (5) how to check LCP and other vitals
  (6) idempotency (7) how Postgres caches (8) rendering 10k events
  (9) sale day with row locks.

### D3 Start here + catch-up
- guides/index.html "Start here": the learning path in order (big
  picture -> infra explorer tours -> code tours -> scenarios -> interview
  mode), with progress; links to every guide.
- Handbook catch-up: cards, stories, concept map, glossary, ADRs for
  every decision in PENDING.md; clear PENDING.md; ROADMAP up to date.
- Fix known outdated docs: aws-foundations.md and
  concepts/infrastructure-as-code.md (aws:profile), glossary (ACM,
  API_INTERNAL_URL), the handbook README "living handbook rule" section,
  docs/17 and docs/20 leftovers.

## Design direction for all HTML pages
Continue the v1 city-plan look (the reader likes it): calm, readable,
distinctive, light + dark, keyboard accessible, offline, no generic
SaaS-card style. One memorable visual idea per page. Plain words,
sentence case. Everything links to everything: map <-> code <-> console
<-> scenario.
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

## 2026-10-12 · docs(handbook): story placement rules + comment fixes

Commit: filled in by the next handbook commit

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

Commit: filled in by the next handbook commit

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

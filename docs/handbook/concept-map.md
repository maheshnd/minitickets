# Concept map

History: see [CHANGELOG.md](CHANGELOG.md) or run `pnpm docs:history`

The hub links every card to its implementation or proposed location. ✅ means built in the repository, 🟡 partial, 📖 explain-only, 📋 planned. AWS acceptance is a separate operational check. Start with the [learning path](guides/index.html), [source tours](guides/code-tours.html) or [scenarios](guides/scenarios.html).

## API

| Concept | Status | Where in our code | Card |
| --- | --- | --- | --- |
| Config validation: fail fast at startup | ✅ built | `apps/api/src/config/env.ts`, `apps/api/src/config/database.ts` | [config-validation](concepts/config-validation.md) |
| CORS | ✅ built | `apps/api/src/app.ts`, `apps/web/src/lib/trpc/client.ts` | [cors](concepts/cors.md) |
| End-to-end types: web imports only `type AppRouter` | ✅ built | `apps/api/src/trpc/router.ts`, `apps/web/src/lib/trpc/client.ts` | [end-to-end-types](concepts/end-to-end-types.md) |
| Central error handling: business error → HTTP status | ✅ built | `apps/api/src/errors.ts`, `apps/api/src/trpc/init.ts` | [error-handling](concepts/error-handling.md) |
| Fastify app: "build" apart from "listen" | ✅ built | `apps/api/src/app.ts`, `apps/api/src/server.ts` | [fastify-app](concepts/fastify-app.md) |
| HTTP methods and status codes | ✅ built | `apps/api/src/trpc/init.ts`, `apps/api/src/app.ts` | [http-status-codes](concepts/http-status-codes.md) |
| HTTP/1.1 vs HTTP/2 vs HTTP/3 | 🟡 partial (browser to edge only) | `infra/src/entry/cdn.ts` | [http-versions](concepts/http-versions.md) |
| Idempotency | ✅ built in repository; live AWS acceptance is separate | `apps/api/src/db/migrate.ts`, `apps/api/src/db/seed.ts` | [idempotency](concepts/idempotency.md) |
| Layered architecture: procedures → services → queries | ✅ built | `apps/api/src/procedures/auth.ts`, `apps/api/src/services/auth.ts` | [layered-api](concepts/layered-api.md) |
| Rate limiting | ✅ built in repository; live AWS acceptance is separate | `apps/api/src/queries/rate-limits.ts`, `apps/api/src/services/rate-limits.ts` | [rate-limiting](concepts/rate-limiting.md) |
| RPC vs REST (why tRPC) | ✅ built | `apps/api/src/trpc/router.ts` | [rpc-vs-rest](concepts/rpc-vs-rest.md) |
| Stateless API servers | ✅ built | `apps/api/src/queries/sessions.ts` | [stateless-servers](concepts/stateless-servers.md) |
| tRPC context, built once per request | ✅ built in repository; live acceptance is separate | `apps/api/src/trpc/context.ts` | [trpc-context](concepts/trpc-context.md) |
| tRPC middleware chain | ✅ built | `apps/api/src/trpc/init.ts` | [trpc-middleware](concepts/trpc-middleware.md) |
| Reverse proxies and `X-Forwarded-For` (`trustProxy`) | ✅ built in repository; live AWS acceptance is separate | `apps/api/src/app.ts`, `apps/api/src/config/trust-proxy.test.ts` | [trust-proxy](concepts/trust-proxy.md) |
| Validation at boundaries: input and output schemas | ✅ built | `apps/api/src/procedures/auth.ts`, `apps/api/src/procedures/account.ts` | [validation-at-boundaries](concepts/validation-at-boundaries.md) |

## AWS Compute

| Concept | Status | Where in our code | Card |
| --- | --- | --- | --- |
| ARM64 (Graviton) images and tasks | ✅ built | `scripts/push-images.sh`, `infra/src/compute/task.ts` | [arm64-graviton](concepts/arm64-graviton.md) |
| AWS Lambda (serverless functions) | ✅ built in repository; live AWS acceptance is separate | `apps/worker/Dockerfile`, `apps/worker/src/lambda.ts` | [aws-lambda](concepts/aws-lambda.md) |
| ECR: the image registry | ✅ built in repository; live acceptance is separate | `infra/src/registry.ts` | [ecr](concepts/ecr.md) |
| ECS cluster and capacity providers | ✅ built | `infra/src/compute/cluster.ts` | [ecs-cluster](concepts/ecs-cluster.md) |
| ECS Exec: a shell inside a running task | ✅ built | `infra/src/compute/iam.ts`, `infra/src/compute/service.ts` | [ecs-exec](concepts/ecs-exec.md) |
| ECS service: desired count, replacement | ✅ built | `infra/src/compute/service.ts`, `infra/src/compute/web-service.ts` | [ecs-service](concepts/ecs-service.md) |
| Execution role vs task role | ✅ built in repository; live acceptance is separate | `infra/src/compute/iam.ts`, `infra/src/compute/web-iam.ts` | [execution-vs-task-role](concepts/execution-vs-task-role.md) |
| Fargate Spot | ✅ built | `infra/src/compute/cluster.ts`, `infra/src/compute/service.ts` | [fargate-spot](concepts/fargate-spot.md) |
| Fargate: containers without managing servers | ✅ built | `infra/src/compute/task.ts`, `infra/src/compute/web-task.ts` | [fargate](concepts/fargate.md) |
| ECS Service Connect and Cloud Map (service discovery) | ✅ built in repository; live AWS acceptance is separate | Explain-only / observational; see card | [service-connect](concepts/service-connect.md) |
| Amazon SES (sending email) | ✅ built in repository; live AWS acceptance is separate | `apps/worker/src/ses-mailer.ts`, `infra/src/jobs/email.ts` | [ses-email](concepts/ses-email.md) |
| Amazon SQS (message queue) | ✅ built in repository; live AWS acceptance is separate | `infra/src/jobs/queues.ts` | [sqs](concepts/sqs.md) |
| Task definition: recipe, revisions, `awsvpc` | ✅ built in repository; live acceptance is separate | `infra/src/compute/task.ts`, `infra/src/compute/web-task.ts` | [task-definition](concepts/task-definition.md) |

## AWS Data

| Concept | Status | Where in our code | Card |
| --- | --- | --- | --- |
| Backups, snapshots, disaster recovery | 🟡 partial (dev settings) | `infra/src/data/postgres.ts`, `infra/src/data/cache.ts` | [backups-dr](concepts/backups-dr.md) |
| Amazon DynamoDB (key-value database) | ✅ built in repository; live AWS acceptance is separate | `infra/src/jobs/processed-jobs-table.ts` | [dynamodb](concepts/dynamodb.md) |
| ElastiCache Valkey: TLS + auth token | ✅ built | `infra/src/data/cache.ts` | [elasticache-valkey](concepts/elasticache-valkey.md) |
| KMS keys (AWS-managed) | 🟡 partial (AWS-managed keys only) | `infra/src/data/postgres.ts`, `infra/src/compute/iam.ts` | [kms](concepts/kms.md) |
| RDS-managed master password (and the rotation limit) | ✅ built (with a known limitation) | `infra/src/data/postgres.ts`, `infra/src/compute/task.ts` | [rds-managed-password](concepts/rds-managed-password.md) |
| RDS Postgres: private, single-AZ, subnet group | ✅ built | `infra/src/data/postgres.ts` | [rds-postgres](concepts/rds-postgres.md) |
| Secrets Manager | ✅ built in repository; live acceptance is separate | `infra/src/data/secrets.ts` | [secrets-manager](concepts/secrets-manager.md) |

## AWS Events

| Concept | Status | Where in our code | Card |
| --- | --- | --- | --- |
| Sns | ✅ built in repository; live AWS acceptance is separate | `apps/api/src/queues/jobs.ts`, `infra/src/jobs/booking-events.ts` | [sns](concepts/sns.md) |

## AWS Network

| Concept | Status | Where in our code | Card |
| --- | --- | --- | --- |
| Application Load Balancer, listener, default 403 | ✅ built | `infra/src/entry/alb.ts`, `infra/src/entry/listener.ts` | [alb](concepts/alb.md) |
| CloudFront: CDN and HTTPS | ✅ built in repository; live AWS acceptance is separate | `infra/src/entry/cdn.ts` | [cloudfront](concepts/cloudfront.md) |
| Origin protection: prefix list + secret header | ✅ built in repository; live AWS acceptance is separate | `infra/src/entry/cdn.ts`, `infra/src/entry/listener.ts` | [origin-protection](concepts/origin-protection.md) |
| Regions and availability zones | ✅ built | `infra/src/network.ts` | [regions-and-azs](concepts/regions-and-azs.md) |
| Route tables and the internet gateway | ✅ built | `infra/src/network.ts` | [route-tables](concepts/route-tables.md) |
| Same-origin path routing: `/trpc/*` → api | ✅ built | `apps/web/src/lib/trpc/client.ts`, `infra/src/entry/listener.ts` | [same-origin-routing](concepts/same-origin-routing.md) |
| Security groups: stateful, group references | ✅ built | `infra/src/security.ts` | [security-groups](concepts/security-groups.md) |
| Public vs private subnets | ✅ built | `infra/src/network.ts` | [subnets](concepts/subnets.md) |
| Target groups and ALB health checks | ✅ built | `infra/src/entry/target-groups.ts` | [target-groups](concepts/target-groups.md) |
| TLS termination: where HTTPS ends | ✅ built in repository; live AWS acceptance is separate | `infra/src/entry/cdn.ts`, `infra/src/entry/listener.ts` | [tls-termination](concepts/tls-termination.md) |
| VPC and CIDR blocks | ✅ built | `infra/src/network.ts` | [vpc](concepts/vpc.md) |

## Async

| Concept | Status | Where in our code | Card |
| --- | --- | --- | --- |
| Transactional outbox | ✅ built in repository; live AWS acceptance is separate | `apps/api/src/db/schema/outbox.ts`, `apps/api/src/queries/bookings.ts` | [outbox](concepts/outbox.md) |
| Reminders | 📖 explain-only | Explain-only / observational; see card | [reminders](concepts/reminders.md) |

## Auth & Security

| Concept | Status | Where in our code | Card |
| --- | --- | --- | --- |
| Authentication vs authorization | ✅ built in repository; live AWS acceptance is separate | `apps/api/src/procedures/account.ts`, `apps/api/src/trpc/init.ts` | [authn-vs-authz](concepts/authn-vs-authz.md) |
| Csp | ✅ built in repository; live AWS acceptance is separate | `apps/web/src/lib/security-policy.ts`, `apps/web/src/proxy.ts` | [csp](concepts/csp.md) |
| CSRF (cross-site request forgery) | ✅ built in repository; live AWS acceptance is separate | `apps/api/src/http/security.ts`, `apps/api/src/procedures/auth.ts` | [csrf](concepts/csrf.md) |
| Door checkin | 📖 explain-only | Explain-only / observational; see card | [door-checkin](concepts/door-checkin.md) |
| Encryption at rest | ✅ built | `infra/src/data/postgres.ts`, `infra/src/data/cache.ts` | [encryption-at-rest](concepts/encryption-at-rest.md) |
| Least privilege | ✅ built in repository; live acceptance is separate | `infra/src/compute/iam.ts`, `infra/src/compute/web-iam.ts` | [least-privilege](concepts/least-privilege.md) |
| Log redaction: no passwords in logs | ✅ built | `apps/api/src/app.ts` | [log-redaction](concepts/log-redaction.md) |
| Open redirect protection | ✅ built | `apps/web/src/features/auth/lib/safe-next.ts`, `apps/web/src/features/auth/lib/safe-next.test.ts` | [open-redirect](concepts/open-redirect.md) |
| Password hashing with argon2id | ✅ built | `apps/api/src/services/auth.ts` | [password-hashing](concepts/password-hashing.md) |
| Presigned urls | ✅ built in repository; live AWS acceptance is separate | `apps/api/src/queries/assets.ts`, `apps/api/src/queries/posters.ts` | [presigned-urls](concepts/presigned-urls.md) |
| Protected procedures: the real auth check | ✅ built | `apps/api/src/trpc/init.ts`, `apps/api/src/procedures/account.ts` | [protected-procedure](concepts/protected-procedure.md) |
| Rbac | ✅ built in repository; live AWS acceptance is separate | `apps/api/src/services/users.ts`, `apps/api/src/trpc/init.ts` | [rbac](concepts/rbac.md) |
| Secrets management: never in code, images or state | ✅ built in repository; live acceptance is separate | `infra/src/data/cache.ts`, `infra/src/compute/task.ts` | [secrets-management](concepts/secrets-management.md) |
| Session cookie flags: HttpOnly, SameSite, Secure | ✅ built in repository; live AWS acceptance is separate | `apps/api/src/procedures/auth.ts`, `apps/web/e2e/login.spec.ts` | [session-cookie](concepts/session-cookie.md) |
| Session revocation | ✅ built in repository; live AWS acceptance is separate | `apps/api/src/queries/sessions.ts`, `apps/api/src/services/users.ts` | [session-revocation](concepts/session-revocation.md) |
| Server-side sessions in Redis vs JWT (and logout) | ✅ built in repository; live AWS acceptance is separate | `apps/api/src/queries/sessions.ts`, `apps/api/src/services/auth.ts` | [sessions-vs-jwt](concepts/sessions-vs-jwt.md) |
| SQL injection: parameterized queries | ✅ built | `apps/api/src/queries/users.ts` | [sql-injection](concepts/sql-injection.md) |
| Ticket signing | 🟡 partial | `apps/worker/src/handlers/tickets.ts`, `apps/worker/src/tickets/token.ts` | [ticket-signing](concepts/ticket-signing.md) |
| Encryption in transit (TLS) | ✅ built (one unencrypted hop in dev) | `apps/api/src/config/database.ts`, `apps/api/Dockerfile` | [tls-in-transit](concepts/tls-in-transit.md) |
| User enumeration: equal timing, one error message | 🟡 partial (login is protected; signup still says "Email already registered") | `apps/api/src/services/auth.ts`, `packages/shared/src/schemas/auth.ts` | [user-enumeration](concepts/user-enumeration.md) |
| XSS (cross-site scripting) | ✅ built in repository; live AWS acceptance is separate | `apps/api/src/procedures/auth.ts`, `apps/web/src/features/account/components/profile-card.tsx` | [xss](concepts/xss.md) |

## Data

| Concept | Status | Where in our code | Card |
| --- | --- | --- | --- |
| Booking row locks | ✅ built | `apps/api/src/queries/bookings.ts` → `createBookingTx` | [row-locks](concepts/row-locks.md) |
| Connection pooling | ✅ built in repository; live AWS acceptance is separate | `apps/api/src/db/client.ts` | [connection-pooling](concepts/connection-pooling.md) |
| Database CHECK constraints | ✅ built | `apps/api/src/db/schema/events.ts` | [db-check-constraints](concepts/db-check-constraints.md) |
| Postgres schema with Drizzle ORM (UUID keys) | ✅ built | `apps/api/src/db/schema/users.ts`, `apps/api/src/db/client.ts` | [drizzle-schema](concepts/drizzle-schema.md) |
| EXPLAIN and EXPLAIN ANALYZE | ✅ built in repository; live acceptance is separate | Explain-only / observational; see card | [explain-analyze](concepts/explain-analyze.md) |
| Indexes (B-tree) | ✅ built in repository; live AWS acceptance is separate | `apps/api/src/db/schema/events.ts`, `apps/api/src/db/schema/users.ts` | [indexing](concepts/indexing.md) |
| Inventory gate | ✅ built in repository; live AWS acceptance is separate | `apps/api/src/queries/inventory.ts`, `apps/api/src/services/booking-inventory.ts` | [inventory-gate](concepts/inventory-gate.md) |
| Keyset pagination | ✅ built in repository; live AWS acceptance is separate | `apps/api/src/queries/event-search.ts`, `apps/api/src/services/event-search.ts` | [keyset-pagination](concepts/keyset-pagination.md) |
| SQL migrations: generate, apply, one-off runner | ✅ built | `apps/api/drizzle.config.ts`, `apps/api/src/db/migrate.ts` | [migrations](concepts/migrations.md) |
| Postgres page cache | 🟡 partial | Explain-only / observational; see card | [postgres-page-cache](concepts/postgres-page-cache.md) |
| Seed data | ✅ built | `apps/api/src/db/seed.ts` | [seed-data](concepts/seed-data.md) |
| SQL vs NoSQL | ✅ built | `apps/api/src/db/schema/users.ts`, `apps/api/src/queries/sessions.ts` | [sql-vs-nosql](concepts/sql-vs-nosql.md) |
| Unique constraint vs check-then-insert (race condition) | ✅ built | `apps/api/src/services/auth.ts`, `apps/api/src/queries/users.ts` | [unique-constraint-race](concepts/unique-constraint-race.md) |

## DevOps & CI/CD

| Concept | Status | Where in our code | Card |
| --- | --- | --- | --- |
| Budget alerts | ✅ built | `infra/src/budget.ts` | [budget-alerts](concepts/budget-alerts.md) |
| Cd oidc | ✅ built in repository; live AWS acceptance is separate | `infra/src/cicd.ts` | [cd-oidc](concepts/cd-oidc.md) |
| CI pipeline: quality, e2e and docker jobs | ✅ built in repository; live AWS acceptance is separate | `.github/workflows/ci.yml` | [ci-pipeline](concepts/ci-pipeline.md) |
| Container hardening: non-root, slim, production-only deps | ✅ built | `apps/api/Dockerfile`, `apps/web/Dockerfile` | [container-hardening](concepts/container-hardening.md) |
| Cost on/off switches | ✅ built in repository; live acceptance is separate | `infra/index.ts` | [cost-switches](concepts/cost-switches.md) |
| Docker layer caching | ✅ built | `apps/api/Dockerfile`, `apps/web/Dockerfile` | [docker-layer-caching](concepts/docker-layer-caching.md) |
| Docker multi-stage builds (and Next.js standalone) | ✅ built | `apps/api/Dockerfile`, `apps/web/Dockerfile` | [docker-multi-stage](concepts/docker-multi-stage.md) |
| Image vulnerability scanning | ✅ built in repository; live AWS acceptance is separate | `.github/workflows/ci.yml`, `infra/src/registry.ts` | [image-scanning](concepts/image-scanning.md) |
| Immutable image tags (git SHA) | ✅ built in repository; live acceptance is separate | `scripts/push-images.sh`, `infra/src/registry.ts` | [immutable-image-tags](concepts/immutable-image-tags.md) |
| Infrastructure as Code with Pulumi | ✅ built | `infra/index.ts` | [infrastructure-as-code](concepts/infrastructure-as-code.md) |
| Monorepo with pnpm workspaces, shared package | ✅ built | `pnpm-workspace.yaml`, `packages/shared/src/index.ts` | [monorepo](concepts/monorepo.md) |
| Release guard | ✅ built in repository; live AWS acceptance is separate | `infra/src/release.ts`, `scripts/deploy-guard.sh` | [release-guard](concepts/release-guard.md) |
| Config from the environment (12-factor), build time vs run time | ✅ built in repository; live acceptance is separate | `apps/api/src/config/env.ts`, `apps/web/Dockerfile` | [twelve-factor-config](concepts/twelve-factor-config.md) |

## Frontend

| Concept | Status | Where in our code | Card |
| --- | --- | --- | --- |
| Forms: shared-schema validation, accessible errors, focus | ✅ built in repository; live AWS acceptance is separate | `apps/web/e2e/security.spec.ts`, `apps/web/src/components/ui/input.tsx` | [accessible-forms](concepts/accessible-forms.md) |
| App Router: file-based routing | ✅ built | `apps/web/src/app/page.tsx`, `apps/web/src/app/dashboard/page.tsx` | [app-router](concepts/app-router.md) |
| Client-side vs server-side rendering | ✅ built in repository; live AWS acceptance is separate | `apps/web/e2e/events.spec.ts`, `apps/web/src/app/events/page.tsx` | [csr-vs-ssr](concepts/csr-vs-ssr.md) |
| Feature folders: components use hooks, never tRPC | ✅ built | `apps/web/src/features/account/hooks/use-profile.ts`, `apps/web/src/features/auth/hooks/use-signup.ts` | [feature-folders](concepts/feature-folders.md) |
| Hydration (and handing the server's data to the browser) | ✅ built | `apps/web/src/lib/trpc/server.ts`, `apps/web/src/features/events/server/prefetch-events.ts` | [hydration](concepts/hydration.md) |
| Live seats | 📖 explain-only | Explain-only / observational; see card | [live-seats](concepts/live-seats.md) |
| Cache invalidation after a mutation | ✅ built in repository; live acceptance is separate | `apps/web/src/features/auth/hooks/use-login.ts`, `apps/web/src/features/auth/hooks/use-logout.ts` | [query-invalidation](concepts/query-invalidation.md) |
| Route guard in the Next.js proxy (UX only, not security) | ✅ built | `apps/web/src/proxy.ts`, `apps/web/e2e/dashboard.spec.ts` | [route-guard-proxy](concepts/route-guard-proxy.md) |
| Search races | ✅ built in repository; live AWS acceptance is separate | `apps/web/src/features/events/hooks/use-event-search.ts` | [search-races](concepts/search-races.md) |
| Server Components vs Client Components | ✅ built | `apps/web/src/app/layout.tsx`, `apps/web/src/providers/query-provider.tsx` | [server-client-components](concepts/server-client-components.md) |
| Server-to-server calls (web server → API) | ✅ built in repository; live AWS acceptance is separate | `.github/workflows/ci.yml`, `apps/web/src/lib/server-env.ts` | [server-to-server-calls](concepts/server-to-server-calls.md) |
| Client state vs server state | ✅ built | `apps/web/src/features/auth/components/signup-form.tsx` | [state-management](concepts/state-management.md) |
| Streaming with Suspense | ✅ built | `apps/web/src/app/events/page.tsx`, `apps/web/src/features/events/components/event-list-skeleton.tsx` | [streaming-suspense](concepts/streaming-suspense.md) |
| Tailwind CSS (utility classes) | ✅ built | `apps/web/postcss.config.mjs`, `apps/web/src/components/ui/container.tsx` | [tailwind](concepts/tailwind.md) |
| TanStack Query: the server-state cache | ✅ built in repository; live acceptance is separate | `apps/web/src/providers/query-provider.tsx`, `apps/web/src/features/auth/hooks/use-me.ts` | [tanstack-query](concepts/tanstack-query.md) |
| tRPC client and request batching | ✅ built | `apps/web/src/lib/trpc/client.ts` | [trpc-client](concepts/trpc-client.md) |
| Showing API errors in the UI (field errors, 401 redirect) | ✅ built | `apps/web/src/features/auth/components/signup-form.tsx`, `apps/web/src/features/auth/components/login-form.tsx` | [ui-error-handling](concepts/ui-error-handling.md) |
| Virtualization | ✅ built in repository; live AWS acceptance is separate | `apps/web/src/features/events/components/virtual-event-list.tsx` | [virtualization](concepts/virtualization.md) |
| Web vitals | ✅ built in repository; live AWS acceptance is separate | `apps/api/src/services/telemetry.ts`, `apps/web/src/features/telemetry/hooks/use-web-vitals.ts` | [web-vitals](concepts/web-vitals.md) |

## Observability

| Concept | Status | Where in our code | Card |
| --- | --- | --- | --- |
| Alerting | ✅ built in repository; live AWS acceptance is separate | `infra/src/budget.ts`, `infra/src/observability/alarm-specs.ts` | [alerting](concepts/alerting.md) |
| CloudWatch Logs: log groups, streams, retention | ✅ built in repository; live AWS acceptance is separate | `infra/src/compute/logs.ts`, `infra/src/compute/task.ts` | [cloudwatch-logs](concepts/cloudwatch-logs.md) |
| Request IDs and correlation IDs | ✅ built in repository; live AWS acceptance is separate | `apps/api/src/app.ts`, `apps/api/src/http/correlation-id.ts` | [correlation-ids](concepts/correlation-ids.md) |
| Metrics | ✅ built in repository; live AWS acceptance is separate | `infra/src/compute/cluster.ts`, `infra/src/observability/dashboard-body.ts` | [metrics](concepts/metrics.md) |
| Slo error budget | 📖 explain-only | Explain-only / observational; see card | [slo-error-budget](concepts/slo-error-budget.md) |
| Structured JSON logs (Fastify's logger, pino) | ✅ built | `apps/api/src/app.ts`, `apps/worker/src/log.ts` | [structured-logging](concepts/structured-logging.md) |
| Tracing | 📖 explain-only | Explain-only / observational; see card | [tracing](concepts/tracing.md) |

## Performance & Caching

| Concept | Status | Where in our code | Card |
| --- | --- | --- | --- |
| Cache-aside | ✅ built in repository; live AWS acceptance is separate | `apps/api/src/queries/events-cache.ts`, `apps/api/src/services/events.ts` | [cache-aside](concepts/cache-aside.md) |
| Cache filter keys | 🟡 partial | `apps/api/src/services/event-filters.ts` | [cache-filter-keys](concepts/cache-filter-keys.md) |
| Cache invalidation | ✅ built in repository; live AWS acceptance is separate | `apps/api/src/queries/events-cache.ts`, `apps/api/src/services/events.ts` | [cache-invalidation](concepts/cache-invalidation.md) |
| Cache key versioning | ✅ built in repository; live AWS acceptance is separate | `apps/api/src/queries/events-cache.ts` | [cache-key-versioning](concepts/cache-key-versioning.md) |
| Cache stampede | ✅ built in repository; live AWS acceptance is separate | `apps/api/src/queries/events-cache.ts`, `apps/api/src/services/single-flight.ts` | [cache-stampede](concepts/cache-stampede.md) |
| CDN caching: hashed static files cached, per-user answers never | ✅ built in repository; live AWS acceptance is separate | `infra/src/entry/cdn.ts` | [cdn-caching](concepts/cdn-caching.md) |
| Compression at the edge (gzip / Brotli) | 🟡 partial (static files only) | `infra/src/entry/cdn.ts` | [compression](concepts/compression.md) |
| Next data cache | ✅ built in repository; live AWS acceptance is separate | `apps/web/src/features/events/server/cached-events.ts` | [next-data-cache](concepts/next-data-cache.md) |
| Stale while revalidate | ✅ built in repository; live AWS acceptance is separate | `apps/api/src/services/events.ts` | [stale-while-revalidate](concepts/stale-while-revalidate.md) |
| TTL (time to live) | ✅ built in repository; live AWS acceptance is separate | `apps/api/src/procedures/auth.ts`, `apps/api/src/queries/events-cache.ts` | [ttl](concepts/ttl.md) |

## Reliability

| Concept | Status | Where in our code | Card |
| --- | --- | --- | --- |
| Autoscaling | 📖 explain-only | Explain-only / observational; see card | [autoscaling](concepts/autoscaling.md) |
| Circuit breaker | 🟡 partial (deployments only) | `infra/src/compute/service.ts`, `infra/src/compute/web-service.ts` | [circuit-breaker](concepts/circuit-breaker.md) |
| Dead-letter queue (DLQ) | ✅ built in repository; live AWS acceptance is separate | `infra/src/jobs/queues.ts` | [dead-letter-queue](concepts/dead-letter-queue.md) |
| Fail fast and timeouts when a dependency is down | ✅ built in repository; live AWS acceptance is separate | `apps/api/src/db/client.ts`, `apps/api/src/queries/events-cache.ts` | [fail-fast](concepts/fail-fast.md) |
| Graceful degradation | ✅ built in repository; live acceptance is separate | `apps/api/src/services/events.ts`, `apps/api/src/queries/events-cache.ts` | [graceful-degradation](concepts/graceful-degradation.md) |
| Graceful shutdown (and PID 1 signals) | ✅ built in repository; live AWS acceptance is separate | `apps/api/Dockerfile`, `apps/api/src/server.ts` | [graceful-shutdown](concepts/graceful-shutdown.md) |
| Health checks: liveness vs readiness | ✅ built | `apps/api/src/app.ts`, `apps/api/src/queries/health.ts` | [health-checks](concepts/health-checks.md) |
| High availability across availability zones | 🟡 partial (multi-AZ shape, single copies) | `infra/src/network.ts`, `infra/src/compute/service.ts` | [high-availability](concepts/high-availability.md) |
| Load balancing algorithms: round robin, least connections, IP hash | 🟡 partial (ALB default) | `infra/src/entry/target-groups.ts` | [load-balancing-algorithms](concepts/load-balancing-algorithms.md) |
| Monolith vs microservices | ✅ built (a modular monolith) | `apps/api/src/trpc/router.ts` | [monolith-vs-microservices](concepts/monolith-vs-microservices.md) |
| Retry policy: retry only what is safe | ✅ built in repository; live AWS acceptance is separate | `apps/web/src/providers/query-provider.tsx`, `apps/worker/src/retry-later.ts` | [retry-policy](concepts/retry-policy.md) |
| Vertical vs horizontal scaling | 🟡 partial (ready to scale out, runs 1 task) | `infra/src/compute/service.ts` | [scaling](concepts/scaling.md) |
| Zero-downtime deploys: rolling update + draining | 🟡 partial | `infra/src/compute/service.ts`, `infra/src/compute/web-service.ts` | [zero-downtime-deploys](concepts/zero-downtime-deploys.md) |

## Testing

| Concept | Status | Where in our code | Card |
| --- | --- | --- | --- |
| End-to-end tests with Playwright (and test data isolation) | ✅ built in repository; live acceptance is separate | `apps/web/playwright.config.ts`, `apps/web/e2e/login.spec.ts` | [e2e-tests](concepts/e2e-tests.md) |
| In-process API tests (no real network) | ✅ built | `apps/api/src/trpc/init.test.ts`, `apps/api/src/config/trust-proxy.test.ts` | [in-process-api-tests](concepts/in-process-api-tests.md) |
| Lighthouse ci | 📖 explain-only | Explain-only / observational; see card | [lighthouse-ci](concepts/lighthouse-ci.md) |
| Static checks: strict TypeScript + lint | ✅ built | `eslint.config.mjs`, `.github/workflows/ci.yml` | [static-checks](concepts/static-checks.md) |
| Testing pyramid | ✅ built in repository; live acceptance is separate | `vitest.config.mts`, `apps/web/playwright.config.ts` | [testing-pyramid](concepts/testing-pyramid.md) |
| Unit tests (Vitest, next to the code) | ✅ built | `vitest.config.mts`, `packages/shared/src/schemas/auth.test.ts` | [unit-tests](concepts/unit-tests.md) |

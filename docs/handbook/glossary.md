# Glossary

History: see [CHANGELOG.md](CHANGELOG.md) or run `pnpm docs:history`

Every technical word used in the handbook, in plain English. When a word has a special meaning in
MiniTickets, the entry says where it lives ("Ours: …", "In our app: …") or that we don't use it.
New words are added in the same commit as the page that first uses them.

```mermaid
flowchart LR
    page["a handbook page<br/>uses a new word"] --> gloss["glossary.md<br/>defines it once"]
    gloss --> card["the word's card<br/>(if it is a concept)"]
```

## A

- **Access Analyzer (IAM)** – an AWS tool that finds unused permissions and resources shared outside
  the account. Not used by us.
- **AccessDenied** – the error AWS returns when IAM says no. It names the action and the resource.
- **Accessible locator** – a test selector that finds elements the way a user or screen reader does
  (`getByLabel`, `getByRole`). Our Playwright tests use them.
- **ACID** – four promises a database makes about a transaction: Atomic (all or nothing),
  Consistent (rules hold), Isolated (transactions don't see each other's half-done work), Durable
  (saved data survives a crash).
- **ACM (AWS Certificate Manager)** – the AWS service that issues and renews TLS certificates for
  domains you own. Not used by us yet.
- **ADR (Architecture Decision Record)** – a short document that records one design decision:
  context, options, decision, consequences.
- **ALB (Application Load Balancer)** – an AWS load balancer that understands HTTP and can route by
  path or header. In our app: `infra/src/entry/alb.ts`.
- **Alerting** – sending a person a message when a measurement crosses a limit. Ours: only the budget email.
- **Allowed** – the second of our three connection questions: does IAM permit this call? See
  [aws-foundations, chapter 3](aws-foundations.md#3-the-three-questions-reach-allowed-password).
- **ALPN** – the step inside the TLS handshake where browser and server agree on HTTP/2 or HTTP/1.1.
- **alt-svc** – a response header in which a server advertises another protocol, for example HTTP/3.
- **Anchor (code anchor)** – a comment `@concept: <slug>` at the exact place a concept lives in the
  code. Checked by `pnpm docs:check`.
- **API gateway** – a front door service that routes, authenticates and rate-limits API calls for many backends. Not used by us.
- **API_INTERNAL_URL** – the address the web *server* uses to call the api (server to server). The browser never uses it. Ours: `apps/web/src/lib/server-env.ts`; `http://localhost:4000` locally, `http://api:4000` in docker compose, not set on AWS yet.
- **App Router** – Next.js's routing system: the folders under `apps/web/src/app/` become URLs.
- **App Runner** – AWS's simplest managed service for container web apps. Not used by us.
- **argon2id** – a password-hashing algorithm that is slow and memory-hungry on purpose, so
  guessing passwords from a stolen database is expensive.
- **ARIA attributes** – extra HTML attributes for assistive technology. Ours: `aria-invalid` ("this
  value is wrong") and `aria-describedby` ("read this error with the field") in `Input`;
  `role="alert"` (announce now) and `role="status"` (announce politely) in the forms.
- **ARM64** – a CPU architecture. AWS's Graviton machines use it. Our images are built for
  `linux/arm64`.
- **ARN (Amazon Resource Name)** – the full, unique address of one AWS resource, e.g.
  `arn:aws:iam::123456789012:role/minitickets-dev-api-task-role`.
- **Assistive technology** – tools people use to read or operate a page, like screen readers
  (VoiceOver, NVDA) or keyboard-only navigation.
- **AssumeRole** – the STS call that "puts on" a role and returns temporary credentials.
- **Async Server Component** – a Server Component written as an `async` function, so it can `await` data while it renders. Ours: `EventListWithServerData` in `apps/web/src/app/events/page.tsx`.
- **Atomic** – happens completely or not at all, with nothing in between that others can see. A
  Postgres insert with a unique check is atomic.
- **Attack surface** – everything an attacker could try to use: open ports, packages, endpoints.
  Fewer packages in an image = smaller attack surface.
- **Aurora** – AWS's own MySQL- and Postgres-compatible database, with storage copied across 3 AZs.
  Not used by us.
- **Auth token (Valkey)** – the password of our cache. It sits inside the `rediss://` URL.
- **Authentication (authN)** – proving who you are (login).
- **Authorization (authZ)** – deciding what you may do once we know who you are.
- **Auto scaling** – adding or removing copies (tasks, machines) automatically based on load. Not built.
- **Availability zone (AZ)** – one isolated part of an AWS region, made of one or more data
  centres. We use two.
- **AWS-managed key (KMS)** – a KMS key that AWS creates and controls for one service, like
  `aws/rds` or `aws/secretsmanager`. We use these.
- **AWS-managed policy** – an IAM policy written and updated by AWS, e.g.
  `AmazonECSTaskExecutionRolePolicy`.
- **awslogs driver** – the ECS setting that copies everything a container prints to CloudWatch Logs.
- **awsvpc** – the ECS network mode that gives every task its own network card and IP address in
  our VPC. Fargate requires it.

## B

- **Backoff (exponential)** – waiting longer after each failed retry (1 s, 2 s, 4 s…). TanStack
  Query's default delay is `min(1000 × 2^n, 30000)` ms.
- **Baseline (measurement)** – the number you measure before changing something, so you can show the change helped. Ours: `events.list` about 1.8 ms typical on a laptop, no cache ([step 21](../21-events-list.md)).
- **Breakpoint (CSS)** – a screen width where the layout changes. Tailwind's `sm:` prefix applies
  from the small breakpoint up.
- **B-tree index** – the default kind of database index: a sorted tree that makes lookups by a
  column fast, and walks in order, so it also serves `ORDER BY` and `LIMIT`. Ours: `events_starts_at_idx`.
- **Backpressure** – a way for a busy part of a system to tell callers to slow down instead of
  collapsing.
- **Backup / snapshot** – a saved copy of a database at a point in time. RDS keeps ours for 1 day.
- **BASE** – "Basically Available, Soft state, Eventually consistent": the looser promises many
  NoSQL systems make instead of ACID.
- **Batching (request batching)** – sending several calls in one HTTP request. tRPC's
  `httpBatchLink` does it for calls made at the same moment.
- **Blast radius** – how much damage one failure or one stolen credential can do.
- **Blue/green deploy** – run the new version next to the old one, then switch all traffic at once.
- **Brotli, gzip** – compression formats. CloudFront compresses our cached static files with them;
  pages can only be compressed by Next.js itself (gzip, its default: verified in the Next.js docs
  and source; not checked on the deployed app). See the [compression card](concepts/compression.md).
- **Budget action** – an AWS Budgets feature that applies an IAM policy or stops resources when a
  threshold is reached. Not used by us.
- **Budget (AWS Budgets)** – an AWS feature that emails when spending passes a limit. Ours: $20 a month.
- **Buffers (EXPLAIN)** – the 8 kB pages a plan step touched. `shared hit` = found in Postgres's memory cache, `shared read` = read from disk. Shown by `EXPLAIN (ANALYZE, BUFFERS)`.
- **Build argument (ARG)** – a value passed to `docker build` (`--build-arg`). Ours:
  `NEXT_PUBLIC_API_URL` in the web Dockerfile, empty by default.
- **BuildKit** – Docker's modern build engine. Gives cache mounts (`RUN --mount=type=cache`) and the
  GitHub Actions cache through Buildx.
- **buildx** – Docker's builder that can build images for another CPU architecture
  (`--platform linux/arm64`).
- **Bulkhead** – walls inside a system so one overloaded part cannot sink the others.
- **Bundle (bundler)** – one JavaScript file made from many source files and packages. esbuild
  bundles our api into `dist/server.js`; Next.js bundles the browser code.
- **Burn rate** – how fast an error budget is being used up; SLO alerts fire on it.
- **Burstable instance** – a small machine (the `t` families, like `t4g`) that saves up CPU credits
  while idle and spends them under load.

## C

- **Cache behavior (CloudFront)** – a rule for one URL path pattern: cache or not, which methods,
  what to forward. We have three.
- **Cache hit / cache miss** – the answer was / was not already stored in the cache.
- **Cache key** – what makes two requests count as "the same" for a cache. For our `/_next/static/*`
  files: the path (plus the normalised `Accept-Encoding`).
- **Cache mount** – a BuildKit folder kept between builds but never part of the image. Ours keeps
  pnpm's download store.
- **Cache policy (CloudFront)** – how long to keep a copy and what makes two requests "the same".
  We use AWS's `Managed-CachingOptimized` and `Managed-CachingDisabled`.
- **Cache stampede (thundering herd)** – many requests miss the cache at the same moment and all hit the database together.
- **cache() (React)** – a React function that remembers a result for the length of one server request. Ours: `getQueryClient` gives each request its own `QueryClient`.
- **Cache-aside** – the app checks the cache first, and on a miss reads the database and fills the cache. Not used by us.
- **Canary deploy** – send a small share of traffic to the new version first, then more if it is healthy.
- **CAP theorem** – a distributed data store that is split by a network failure must choose between
  answering (availability) and always giving the latest data (consistency).
- **Capacity provider (ECS)** – the kind of machine tasks run on: `FARGATE` or `FARGATE_SPOT`.
- **Capacity provider strategy (ECS)** – how a service splits its tasks between capacity providers
  (a base plus weights). Ours: 100% `FARGATE_SPOT`.
- **Card** – one handbook page about one concept, in `docs/handbook/concepts/<slug>.md`.
- **CD (continuous deployment)** – automatically deploying every change that passes CI. Planned.
- **CDN (content delivery network)** – servers around the world that serve content close to the
  visitor. Ours is CloudFront.
- **Certificate authority (CA)** – an organisation whose signature on a TLS certificate we trust.
- **CHANGELOG** – a file listing what changed, when and why. Ours: [CHANGELOG.md](CHANGELOG.md), one
  entry per handbook commit.
- **CHECK constraint** – a rule inside a table that Postgres tests on every insert and update, for any writer. Ours: three on `events` seat counts ([card](concepts/db-check-constraints.md)).
- **CI (continuous integration)** – running the checks (types, lint, tests, builds) on every push.
  Ours: `.github/workflows/ci.yml`.
- **CIDR block** – a range of IP addresses written like `10.0.0.0/16`. The number after the slash
  says how many leading bits are fixed.
- **Circuit breaker** – stops calling something that keeps failing, for a while, instead of
  retrying forever. ECS has one for deployments.
- **Client Component** – a React component that also runs in the browser (it starts with
  `"use client"`), so it can have state and click handlers.
- **Clock skew** – two computers' clocks disagree. It matters when one side judges the age of data stamped by the other.
- **Cloud Map** – AWS's service registry: names (like `api`) and where each one runs right now. ECS Service Connect uses it. Not built (planned).
- **CloudFront** – AWS's CDN. In our app: HTTPS in front of the ALB, `infra/src/entry/cdn.ts`.
- **CloudTrail** – AWS's audit log of API calls made in an account.
- **CloudWatch alarm** – watches one metric and notifies (for example through SNS) when it crosses a
  threshold. We have none yet.
- **CloudWatch Logs** – AWS's log storage. A **log group** is one book (`/minitickets/dev/api`);
  each task writes its own **log stream** (a chapter) in it.
- **CloudWatch Logs Insights** – a query language for searching and counting log lines in log
  groups.
- **CLS (Cumulative Layout Shift)** – how much visible content moves while a page loads; 0 means nothing moved. A Core Web Vital. Ours: 0.084 on the client-rendered `/events` (the footer moved), usually 0 with SSR.
- **Cluster (ECS)** – a named group that ECS services and tasks belong to. Ours: `minitickets-dev`.
- **Codegen** – generating code (like an API client) from a schema file. tRPC avoids it by sharing
  TypeScript types directly.
- **Coerce (Zod)** – convert before checking: `z.coerce.number()` turns the env string `"4000"` into
  the number `4000`.
- **Composite index** – one index on several columns, like `(user_id, created_at)`. Sorted by the first column, then the second inside each first value, so it only helps queries that use the leading column(s). 📖 explain-only for us.
- **Concept map** – [concept-map.md](concept-map.md): the hub table of every concept.
- **Condition (IAM)** – an extra "only if" in a policy statement, e.g. only when
  `aws:SourceAccount` is our account.
- **Confused deputy** – a trusted service tricked into using its power for the wrong customer.
- **Connection pool** – a small set of open database connections that are reused, because opening
  one is slow. Ours: `pool` in `apps/api/src/db/client.ts`, at most 10.
- **Container** – a packaged program with everything it needs, started from an image.
- **Container Insights** – extra, paid CloudWatch metrics per ECS task. Off in our cluster.
- **Content hash** – a fingerprint of a file's content put into its name (`main-3f9a1c.js`), so new
  content always gets a new name.
- **Content-Security-Policy (CSP)** – a response header that tells the browser which scripts may run. Not set by us yet.
- **Context (tRPC)** – the `ctx` object built once per request by `createContext`; every procedure receives it.
- **Contract testing** – checking that a provider and a consumer still agree on the shape of their API.
- **Cookie** – a small value the browser stores and sends back with each request to the same site.
  Our session cookie is called `sid`.
- **Core Web Vitals** – Google's page-experience measurements: loading speed, responsiveness, layout stability.
- **Corepack** – a tool shipped with Node that installs the package manager version a project asks
  for (`packageManager` in `package.json`). Our Dockerfiles use it to get pnpm 10.33.2.
- **Correlation ID** – one id passed along every service a request touches, so their logs can be joined.
- **CORS (Cross-Origin Resource Sharing)** – browser rules that block a page from calling another
  origin unless that origin allows it.
- **Cost Anomaly Detection** – an AWS feature that alerts on unusual spending. Not used by us.
- **CQRS** – using separate models for writing data and for reading it.
- **CREATE INDEX CONCURRENTLY** – a way to build an index without blocking writes to the table. Slower, and it cannot run inside a transaction, so it does not fit in a drizzle migration. Plain `CREATE INDEX` blocks writes while it runs.
- **Credential stuffing** – trying username/password pairs leaked from other sites. User enumeration
  and missing rate limits make it easier.
- **CSR (client-side rendering)** – the browser gets the page frame and then fetches the data and draws it. Ours: `/events` in Step 21; since Step 22 only the fallback when the server could not fetch ([card](concepts/csr-vs-ssr.md)).
- **CSRF (cross-site request forgery)** – another website tricking your browser into sending a
  request to ours, with your cookie.
- **Customer-managed key (KMS)** – a KMS key that you create and control (policy, rotation,
  disabling). Not used by us.
- **Customer-managed policy** – a reusable IAM policy that we write and own.
- **CVE** – a public id for one known security vulnerability, like `CVE-2024-12345`.

## D

- **Data layer** – our RDS database, Valkey cache and redis-url secret, switched on and off together
  with `dataEnabled`.
- **Data residency** – rules about which country data must be stored in.
- **Dead-letter queue (DLQ)** – where messages go after failing too many times, so they can be
  inspected instead of lost.
- **Default deny (implicit deny)** – IAM's starting answer: anything not allowed is denied.
- **Defense in depth** – several independent protections, so one mistake does not expose everything.
- **Dehydrate / hydrate (TanStack Query)** – turn the query cache into plain JSON on the server (dehydrate) and load it into the browser's cache (hydrate). Ours: `prefetchEvents` and `HydrationBoundary`.
- **Dependabot** – GitHub's bot that opens pull requests to update vulnerable or old dependencies.
  Not used by us.
- **Deployment circuit breaker (ECS)** – stops an ECS deployment whose new tasks keep failing and
  rolls back to the last working revision. On for both our services.
- **Deregistration delay (draining)** – the time the ALB keeps a stopping task in its list so
  requests already in flight can finish. Ours: 30 seconds.
- **Digest (image)** – the sha256 hash of an image's content. Unlike a tag, it can never point at
  different content.
- **Digest (Next.js error)** – an id Next.js gives an error thrown on the server. The browser gets only the id; the full error is in the web server's log under the same id. Ours: shown as "Error id" by `app/events/error.tsx`.
- **Directive ("use client")** – a string at the top of a file that tells Next.js this is a Client
  Component, sent to the browser as JavaScript.
- **Disaster recovery (DR)** – how we get the system and its data back after a big failure.
- **Distributed tracing** – following one request across several services, with timings for each step.
- **Distroless image** – a container image with only the runtime and the app: no shell, no package
  manager. Smaller and harder to attack; harder to debug.
- **DNS** – the internet's phone book: turns a name like `example.com` into an IP address.
- **Docker** – the tool that builds images and runs containers.
- **Drift** – the real cloud no longer matches what the IaC code and state expect, usually because
  someone changed it by hand.
- **Drizzle** – the TypeScript ORM (database library) we use to define tables and write queries.
- **Dynamic rendering (Next.js)** – rendering a page on every request instead of once at build time. `export const dynamic = "force-dynamic"` forces it; the build output marks such pages `ƒ`. Ours: `/events`.
- **DynamoDB** – AWS's managed NoSQL key-value and document database. Not used by us.

## E

- **EC2** – AWS's virtual machines. We use Fargate instead, so we manage no EC2 machines.
- **ECR (Elastic Container Registry)** – AWS's private store for Docker images.
- **ECS (Elastic Container Service)** – AWS's service that runs containers.
- **ECS Exec** – opens a shell or runs a command inside a running ECS task
  (`aws ecs execute-command`).
- **Edge location** – one of CloudFront's buildings close to visitors.
- **EKS** – AWS's managed Kubernetes. Not used by us.
- **ElastiCache** – AWS's managed Redis / Valkey / Memcached service.
- **EMF (Embedded Metric Format)** – a JSON log format that CloudWatch turns into metrics. Not used
  by us.
- **Encryption at rest** – data is encrypted on disk and in backups.
- **Encryption in transit** – data is encrypted while it travels over the network (TLS).
- **End-to-end (e2e) test** – a test that drives the real app in a real browser. Ours use Playwright.
- **End-to-end types** – the web app gets the API's TypeScript types (`type AppRouter`), so a wrong call is a compile error.
- **Endpoint (AWS)** – the address of an AWS service's API, e.g. Secrets Manager in us-east-1.
- **Env var (environment variable)** – a named setting given to a process when it starts, like
  `PORT=4000`.
- **Envelope encryption** – data is encrypted with a data key, and the data key is encrypted with a
  KMS key.
- **Error boundary** – a component that catches errors thrown while its children render and shows a fallback instead of a broken page. In Next.js it is an `error.tsx` file. Ours: `apps/web/src/app/events/error.tsx`.
- **errorMapper** – our tRPC middleware that turns business errors into HTTP-style errors
  (`apps/api/src/trpc/init.ts`).
- **esbuild** – a very fast JavaScript/TypeScript bundler. Builds our api (`apps/api/build.mjs`).
- **Escaping (output encoding)** – turning special characters like `<` into harmless text before
  showing them. React does it for every `{value}`.
- **Event sourcing** – storing every change as an event and rebuilding the current state from them.
- **EventBridge** – AWS's event bus: rules react to events from AWS services or apps. Not used by
  us.
- **Event-driven architecture** – parts of a system react to events ("user signed up") instead of calling each other directly.
- **Eventual consistency** – copies of data may disagree for a short time but will agree in the end.
- **Eviction** – a cache deleting entries when it is full. **LRU** (least recently used) deletes the oldest-used first.
- **Exec form (Docker CMD)** – `CMD ["node", "server.js"]`, a JSON list: the program runs directly
  as PID 1 and receives signals. Shell form (`CMD node server.js`) runs it through `/bin/sh`.
- **exec format error** – the error you get when a program was built for another CPU architecture.
- **Execution role** – the IAM role ECS wears to **start** a task: pull the image, read secrets,
  write logs.
- **Expand and contract** – changing a database schema in safe steps: add the new shape, move the code, then remove the old shape.
- **EXPLAIN** – a Postgres command that shows how a query will run (index scan or sequential scan).
  `EXPLAIN ANALYZE` also runs it and shows real timings. See [explain-analyze](concepts/explain-analyze.md).
- **Explain-only (📖)** – a handbook status: not in our app and not planned; explained only.
- **Explicit deny** – a `"Effect": "Deny"` statement. It beats every allow.

## F

- **Fail fast** – stop with a clear error as early as possible instead of continuing in a broken
  state. Ours: env validation at startup; Redis commands with no offline queue.
- **Fail open (ALB)** – when every target in a group is unhealthy, the ALB sends traffic to all of
  them anyway.
- **Fargate** – ECS without servers to manage: AWS finds a machine for each task.
- **Fargate Spot** – Fargate on spare AWS capacity, much cheaper, but AWS can take it back with a
  2-minute warning.
- **Fastify** – the Node.js web framework our api uses.
- **FCP (First Contentful Paint)** – when the first text or image appears on screen.
- **Feature flag** – a switch that turns a feature on or off without a new deploy.
- **Feature folder** – `apps/web/src/features/<feature>/`: the components and hooks of one feature
  together.
- **FireLens / Fluent Bit** – a log-router sidecar for ECS that can send logs to other tools. Not
  used by us.
- **Flaky test** – a test that sometimes passes and sometimes fails without a code change, usually
  because of timing.
- **Focus management** – moving keyboard focus to the right element on purpose. Our forms focus the
  first invalid field after a failed submit.
- **Frozen lockfile** – `pnpm install --frozen-lockfile`: install exactly what `pnpm-lock.yaml` says
  and fail if it doesn't match `package.json`. Used in CI and Docker.

## G

- **gcTime (TanStack Query)** – how long an unused cache entry is kept before it is deleted. Default
  5 minutes in the browser.
- **generate_series** – a Postgres function that produces a list of numbers, like `generate_series(1, 200000)`. We use it to make 200 000 fake rows for `EXPLAIN` experiments.
- **Global service** – an AWS service that exists once per account, not per region (IAM,
  CloudFront, Budgets).
- **Golden signals** – the four basic service measurements: latency, traffic, errors, saturation.
- **gp3** – AWS's current general-purpose SSD disk type. Our RDS disk is 20 GB gp3.
- **Grace period (health check)** – the time after a task starts during which ECS ignores failed ALB
  health checks. Ours: 60 seconds.
- **Graceful shutdown** – on a stop signal, stop taking new requests, finish the running ones,
  close connections, then exit.
- **GraphQL** – an API style where the client asks for exactly the fields it needs in one query.
- **Graviton** – AWS's ARM64 processors. Usually cheaper than x86 for the same work.
- **gRPC** – a fast binary RPC protocol over HTTP/2, mostly used between servers.

## H

- **Hash** – a one-way fingerprint of data. It cannot be turned back into the data.
- **Head-of-line blocking** – one lost or slow item holds up everything queued behind it.
- **Health check** – a regular "are you OK?" call. **Liveness** = is the process up (`/health`).
  **Readiness** = can it do real work right now (`/ready`).
- **High availability (HA)** – the system keeps working when one part (a task, an AZ) fails.
- **Horizontal scaling** – more copies of a server. **Vertical scaling** – a bigger server.
- **HOT update (Postgres)** – "heap-only tuple": an update that changes no indexed column, so Postgres does not need to touch the indexes. One reason not to index columns that change often, like `seats_left`.
- **HTML-limited bot (Next.js)** – a crawler or link-preview bot that reads only HTML. Next.js recognises them by user agent and waits for the page metadata before streaming. The list includes `Chrome-Lighthouse`.
- **HTTP status code** – the 3-digit result of an HTTP request: 200 OK, 400 bad input, 401 not logged in, 403 forbidden, 404 not found, 409 conflict, 500 server error, 503 unavailable.
- **HTTP/2, HTTP/3** – newer HTTP versions that are faster over one connection. CloudFront speaks
  them to browsers.
- **HttpOnly** – a cookie flag: page JavaScript cannot read the cookie.
- **HTTPS** – HTTP inside TLS: encrypted, and the server proves who it is.
- **Hydration** – React attaching state and event handlers in the browser to HTML that the server
  already rendered, without drawing it again ([card](concepts/hydration.md)).
- **Hydration mismatch** – the server's HTML and the browser's first render differ, so React logs an error and redraws that part in the browser. We avoid one for dates with `EventDate`.
- **HydrationBoundary** – a TanStack Query component that takes a dehydrated cache (JSON from the server) and puts it into the browser's cache. Ours: in `apps/web/src/app/events/page.tsx`.

## I

- **IaC (Infrastructure as Code)** – describing cloud resources in code. Ours: Pulumi in `infra/`.
- **IAM (Identity and Access Management)** – AWS's system of who may do what.
- **IAM database authentication** – logging in to RDS with a short-lived IAM token instead of a
  stored password. Not used by us.
- **Idempotency key** – a unique id a client sends with a write, so the server can recognise and ignore a repeat. Not used by us.
- **Idempotent** – doing it twice has the same effect as doing it once. Our logout is idempotent.
- **Identity-based policy** – an IAM policy attached to a principal (role, user, group). It has no
  `Principal` field.
- **IDOR (insecure direct object reference)** – reading or changing someone else's data by changing
  an id in a request. We avoid it by taking the user id from the session, never from input.
- **Image (Docker)** – the packaged, read-only file system and start command a container is started from.
- **Image scanning** – checking an image's packages for known vulnerabilities. ECR scans ours on push.
- **import type** – a TypeScript import used only for type checking and removed from the output. The
  web uses it for `AppRouter`, so no api code reaches the browser.
- **Index Scan** – a plan step that walks an index to the matching spot and then reads those table rows. Seen for `listUpcoming` with `events_starts_at_idx`.
- **Init process** – a tiny PID 1 that forwards signals and cleans up finished child processes
  (`initProcessEnabled` on our api task).
- **In-process test** – a test that calls the API's code directly (no real network), e.g. with `createCallerFactory` or Fastify's `inject`.
- **Inline policy** – an IAM policy that belongs to exactly one role and is deleted with it.
  Ours: `read-secrets`, `ecs-exec`.
- **Inspector (Amazon)** – AWS's vulnerability scanner, used by ECR's enhanced scanning. Not used by
  us.
- **Internal ALB** – a load balancer with no public address, reachable only inside the VPC. One option for web → api on AWS; not built.
- **Internet gateway (IGW)** – the VPC's door to the public internet.
- **Invalidate / clear (TanStack Query)** – invalidate marks cached answers stale and refetches the
  ones in use; clear deletes the whole cache. Login invalidates `auth.me`; logout clears everything.
- **Invalid index** – an index left half-built when `CREATE INDEX CONCURRENTLY` fails. It costs writes but is never used. Find it with `pg_index.indisvalid`, drop it, and retry.
- **Isolation level** – how much concurrent database transactions may see of each other's changes.

## J

- **Jitter** – a small random amount added to a delay, so many clients don't retry or expire at the
  same moment.
- **JSON** – a text format for data, e.g. `{"userId": "…"}`.
- **JWT (JSON Web Token)** – a signed token that carries user data itself, so the server does not
  look up a session. We use server-side sessions instead.

## K

- **Kafka** – a distributed log for event streams; consumers read at their own pace and can replay.
- **Keyset (cursor) pagination** – getting the next page by remembering the last row seen (`where (starts_at, id) > (…) order by starts_at, id limit 50`) instead of skipping rows with `OFFSET`. Stays fast on deep pages. 📋 planned for us if the list needs pages.
- **Key-value store** – a database that stores a value under a key and finds it by that key only.
  Redis and Valkey are key-value stores.
- **KMS (Key Management Service)** – AWS's service for encryption keys. We use AWS-managed keys.

## L

- **Lambda** – AWS's functions-as-a-service: code runs per event, no server or container to keep running. Not used by us.
- **Latency** – the time a request takes to travel to the server and back.
- **Layer (Docker)** – one cached step of an image build. Unchanged layers are reused.
- **Layered architecture** – our api's split: procedures (HTTP edge) → services (business logic) → queries (data stores).
- **LCP (Largest Contentful Paint)** – when the biggest text block or image in view was drawn. A Core Web Vital. Ours: the heading "Upcoming events" on `/events`.
- **LCU (Load Balancer Capacity Unit)** – how ALB usage beyond its fixed hourly price is measured
  and billed.
- **Least outstanding requests** – an ALB algorithm that picks the target with the fewest requests
  in progress.
- **Least privilege** – give every role, user or rule only the permissions it needs.
- **Lifecycle policy (ECR)** – rules that delete old images automatically. Ours: untagged after 1
  day, keep the newest 10 tagged.
- **Lighthouse** – Google's tool that loads a page in Chrome, simulates a slow phone and network (the mobile preset), and reports timings and a 0-100 performance score. We ran the CLI, version 13.5.0.
- **Lint** – automatic checks for suspicious code patterns. Ours: ESLint (`pnpm lint`).
- **Listener (ALB)** – the ALB's "ear" on one port (ours: HTTP 80). Its **rules** decide where each
  request goes; the **default action** applies when no rule matches (ours: 403).
- **Liveness vs readiness** – liveness: is the process alive (`/health`)? Readiness: can it do real
  work, with its databases reachable (`/ready`)? Liveness drives restarts; readiness drives routing.
- **Load balancing algorithm** – how a load balancer picks a target: round robin (in turn), least connections, IP hash.
- **Load testing** – sending lots of fake traffic to find the limits of a system.
- **Local route** – the built-in route in every VPC route table that connects all subnets of the VPC.
- **Lockfile** – a file that records the exact version of every installed package. Ours:
  `pnpm-lock.yaml`.
- **Locking** – stopping two writers from changing the same data at once. **Pessimistic** locks first; **optimistic** checks a version when saving.
- **Log level** – how serious a log line is. pino numbers: 30 info, 40 warn, 50 error.
- **Long polling** – the client asks, and the server holds the answer back until something new happens.
- **Longest prefix match** – a route table uses the most specific route that matches (`/16` beats
  `/0`).

## M

- **Main route table** – the VPC's default route table, used by any subnet that has no explicit
  association.
- **Managed prefix list** – a named list of IP ranges that a security group rule can point at. We
  use AWS's list of CloudFront's origin-facing addresses.
- **Man-in-the-middle** – an attacker between two parties who reads or changes their traffic.
  Checking TLS certificates stops it.
- **Median** – the middle value of a sorted list. One odd run moves it less than it moves the average.
- **Memory-hard** – an algorithm that needs a lot of memory per try, which makes cracking with GPUs
  expensive. argon2id is memory-hard.
- **Mermaid** – a text format for diagrams that GitHub renders. All handbook diagrams use it.
- **Message queue** – a buffer where one part leaves work and another picks it up later (e.g. AWS SQS).
- **Metrics** – numbers measured over time, like CPU use or requests per second.
- **MFA (multi-factor authentication)** – a second proof besides the password, like a code from an app.
- **Middleware** – code that wraps a request handler and runs before and/or after it.
- **Migration** – a versioned SQL file that changes the database schema.
- **Minimum healthy / maximum percent (ECS)** – how far below and above the desired task count a
  deployment may go. Defaults: 100% and 200%.
- **Mock** – a fake stand-in for a real dependency in a test.
- **Modular monolith** – one deployable service, split inside into clear modules. Our api: one
  service, features `auth` and `account`.
- **Monolith vs microservices** – one deployable app vs many small services that call each other over the network.
- **Monorepo** – one git repository with several packages. Ours: `apps/web`, `apps/api`,
  `packages/shared`, `infra`.
- **mTLS / service mesh** – both sides of a connection prove who they are with certificates; a mesh
  does this for every service. Not used by us.
- **Multi-AZ (RDS)** – a standby copy of the database in a second AZ that takes over if the first
  fails. Off in our dev setup.
- **Multi-stage build** – a Dockerfile with several `FROM` stages; only the last one becomes the image.
- **Mutation (tRPC)** – a procedure that changes something, like `auth.login`. Sent as `POST`.

## N

- **N+1 queries** – one query for a list, then one more query per item: slow as the list grows.
- **NAT gateway** – lets things in a private subnet start connections to the internet. We chose not
  to build one (cost).
- **Network ACL (NACL)** – a stateless firewall on a whole subnet. We keep AWS's default, which allows everything.
- **Network interface (ENI)** – a virtual network card with an IP address. Each Fargate task gets one.
- **Next.js** – the React framework our web app uses.
- **NLB (Network Load Balancer)** – a layer-4 AWS load balancer: forwards TCP connections without
  reading HTTP.
- **Non-root user** – running a container process as an ordinary user instead of root. Ours: `USER
  node` (uid 1000).
- **Normalization** – storing each fact once and linking tables by keys. **Denormalization** copies data on purpose for faster reads.

## O

- **OAuth 2.0** – a standard for letting an app act for a user at another service. **PKCE** protects the authorization-code flow against stolen codes.
- **Offline queue (ioredis)** – commands that ioredis holds while disconnected and sends after
  reconnecting. We turn it off so commands fail at once.
- **OFFSET** – an SQL clause that skips N rows. Postgres still produces the skipped rows, so deep pages get slower. See Keyset pagination.
- **OIDC federation** – letting an outside system (like GitHub Actions) get AWS role credentials
  without stored keys.
- **On-demand** – normal capacity that AWS never takes back (the opposite of Spot).
- **Open redirect** – a bug where a link like `/login?next=https://evil.com` sends a user to
  another site after login. Blocked by `getSafeNext`.
- **OpenAPI** – a standard file format that describes a REST API, used to generate docs and clients.
- **OpenTelemetry (OTel)** – an open standard and toolkit for traces, metrics and logs.
- **Optimistic update** – the UI shows the result before the server confirms it, and undoes it on failure.
- **Origin (browser)** – scheme + host + port of a page, e.g. `http://localhost:3000`.
- **Origin (CloudFront)** – where CloudFront fetches from when it has no cached copy. Ours: the ALB.
- **Origin request policy (CloudFront)** – what CloudFront forwards to the origin. We use
  `Managed-AllViewer` (all headers, cookies and query strings).
- **Origin secret** – the random `X-Origin-Verify` header value that only our CloudFront
  distribution sends, and our ALB listener checks.
- **ORM** – a library that maps database tables to code objects. Ours: Drizzle.
- **Outbox (transactional outbox)** – writing an event into the database in the same transaction as the change, and publishing it later.

## P

- **Pagination** – returning a long list page by page: by offset ("skip 40") or by cursor ("after this id").
- **Parameterized query** – SQL with placeholders (`$1`); the values travel separately, so they can never be read as SQL.
- **Parse vs validate** – validating says yes or no; parsing also returns a cleaned, typed value (`"
   Bob@X.com "` → `"bob@x.com"`). Zod parses.
- **Partial (🟡)** – a handbook status: part of the concept is in our code.
- **Partial index** – an index on only some rows of a table, like `… (starts_at) where seats_left > 0`. Smaller, but only used when the query's `WHERE` implies the index's. 📖 explain-only for us.
- **Partition (ARN)** – the first part of an ARN: which AWS (`aws`, `aws-cn`, `aws-us-gov`).
- **Partitioning** – splitting one big table into parts inside one database. **Sharding** splits data across several databases.
- **Passkey** – a login that uses a key stored on the user's device instead of a password
  (WebAuthn). Not built.
- **Password (the question)** – the third of our connection questions: does the target accept the
  credentials? See [aws-foundations, chapter 3](aws-foundations.md#3-the-three-questions-reach-allowed-password).
- **Pepper** – a secret added to passwords before hashing and kept outside the database. Not used by
  us.
- **Permission boundary** – an IAM limit on the most a role may ever do. Not used by us.
- **Permission policy** – the policy that says what a role may do.
- **PID 1** – the first process in a container. Docker sends stop signals to it.
- **pino** – the JSON logger built into Fastify.
- **PITR (point-in-time recovery)** – restoring a database to any second inside its backup retention
  window.
- **Planned (📋)** – a handbook status: not built yet, but a step doc says we will build it.
- **Planner (query planner)** – the part of Postgres that picks the cheapest way to run a query, using estimates from table statistics. `EXPLAIN` shows what it chose.
- **Playwright** – the tool our end-to-end tests use to drive a real browser.
- **Policy (IAM)** – a JSON document of Allow/Deny statements.
- **PostCSS** – a tool that transforms CSS with plugins. Tailwind v4 runs as a PostCSS plugin in our
  web app.
- **Postgres (PostgreSQL)** – the SQL database we use. On AWS: RDS Postgres 17.
- **Prefetch (TanStack Query)** – fetching a query before a component asks for it and keeping the answer in the cache. `prefetchQuery` never throws. Ours: `prefetchEvents`.
- **Preflight** – an `OPTIONS` request a browser sends before some cross-origin requests, to ask
  CORS permission.
- **preStop hook** – a Kubernetes step that runs before a container gets SIGTERM, often a short
  sleep so the load balancer stops routing first. Our planned "wait after SIGTERM" is the same idea.
- **Price class (CloudFront)** – which group of edge locations a distribution uses. Ours:
  `PriceClass_100`.
- **Principal** – who makes an AWS request: a user, a role, or an AWS service.
- **Private subnet** – a subnet with no route to the internet gateway.
- **Problem Details (RFC 9457)** – a standard JSON format for HTTP API errors. Not used by us (tRPC
  has its own error shape).
- **Procedure (tRPC)** – one API function, like `auth.login`. Lives in `apps/api/src/procedures/`.
- **protectedProcedure** – our tRPC procedure builder that rejects callers without a valid session.
- **Protocol-relative URL** – a URL starting with `//` (`//evil.com`): "same scheme, any host".
  `getSafeNext` rejects it.
- **Proxy (network)** – a server that stands between the visitor and us and passes requests on.
  CloudFront and the ALB are proxies.
- **Proxy (Next.js `proxy.ts`)** – code that runs on the web server before a page renders (older
  Next.js called it "middleware"). Ours redirects to `/login` when there is no `sid` cookie.
- **Public subnet** – a subnet whose route table sends `0.0.0.0/0` to the internet gateway.
- **Pulumi** – our Infrastructure as Code tool. A **stack** is one copy of the infrastructure
  (ours: `dev`); **config** holds its settings (`Pulumi.dev.yaml`); **outputs** are values it
  prints for others to use (`pulumi stack output`).
- **Pulumi secret** – a value Pulumi keeps encrypted in its state and prints as `[secret]`.
- **Pulumi state** – Pulumi's record of what it created; it compares it with the code to work out
  what to change.

## Q

- **Query (our api layer)** – `apps/api/src/queries/`: the only code that touches Postgres or Redis.
- **Query (tRPC)** – a procedure that only reads, like `auth.me`. Sent as `GET`.
- **QUIC** – a transport protocol over UDP that HTTP/3 runs on.

## R

- **RabbitMQ** – a message broker that routes messages to queues; messages are usually gone once consumed.
- **Race condition** – a bug where the result depends on the timing of two things happening at once,
  like two signups with the same email.
- **Rainbow table** – a precomputed list of hashes for common passwords. A per-user salt makes it
  useless.
- **Rate limiting** – limiting how many requests one caller may make per time window. Planned.
- **Rate-limiting algorithms** – **token bucket** (tokens refill at a fixed rate, each request spends one), **leaky bucket** (requests drain at a fixed rate), **fixed window** (count per minute), **sliding window** (count over the last minute).
- **RBAC / ABAC** – role-based access control (permissions by role, like "admin") / attribute-based (rules on attributes, like tags or department).
- **RDS (Relational Database Service)** – AWS's managed SQL databases. Ours runs Postgres 17.
- **RDS Proxy** – an AWS connection pooler in front of RDS. Not used by us.
- **Reach** – the first of our connection questions: can packets get there at all? See
  [aws-foundations, chapter 3](aws-foundations.md#3-the-three-questions-reach-allowed-password).
- **Read replica** – a read-only copy of a database that follows the primary.
- **Read-through / write-through / write-behind** – cache patterns: the cache loads misses itself / every write goes to cache and database together / writes go to the cache and reach the database later.
- **Redis** – an in-memory key-value store. We keep sessions in it (locally Redis 7.4, on AWS Valkey).
- **Region** – a geographic area of AWS with several AZs. Ours: `us-east-1`.
- **Regional service** – lives in one region (VPC, ECS, RDS, ECR, Secrets Manager).
- **Rehash on login** – when hash settings get stronger, re-hash a user's password with the new
  settings the next time they log in successfully. Not built.
- **Rendering strategies** – **SSR** (render HTML per request), **SSG** (render at build time), **ISR** (static, re-rendered in the background), **streaming** (send HTML in pieces).
- **Replication** – keeping copies of data on several machines.
- **Replication group (ElastiCache)** – a primary cache node plus optional replicas. Ours has 1 node.
- **Request ID** – an id for one request inside one service. Fastify gives every request one (`request.id`).
- **Request smuggling** – an attack using malformed or ambiguous headers so that a proxy and the
  server behind it disagree on where one request ends.
- **Resource (IAM)** – the thing an action acts on, named by its ARN.
- **Resource-based policy** – a policy attached to a resource; it names who may use it. A role's
  trust policy is one.
- **Reverse proxy** – a proxy on the server side that receives requests for one or more backends. CloudFront and the ALB are ours.
- **Revision (task definition)** – each change to a task definition creates a new numbered version
  (`minitickets-dev-api:7`).
- **Revocation** – making a credential stop working before it expires. Logout deletes the session in
  Redis, which revokes the cookie at once.
- **Role (IAM)** – a set of permissions with no password, assumed for a while by a trusted principal.
- **Rollback** – going back to the last version that worked.
- **Rolling update** – replacing old tasks with new ones a few at a time, so some are always serving.
- **Rotation** – replacing a password with a new one on a schedule. RDS rotates its managed
  password every 7 days by default.
- **Route 53** – AWS's DNS service. Not used by us yet.
- **Route table** – the list that says where traffic leaving a subnet goes.
- **RPO / RTO** – how much data you may lose (recovery point objective) / how long recovery may take
  (recovery time objective).
- **RunError (Pulumi)** – stops the Pulumi program with a plain message and no stack trace. Our
  switches use it.

## S

- **S3** – AWS's object storage for files. Not used by us.
- **Saga** – a long business process split into steps, each with an "undo" step if a later one fails.
- **Salt** – random bytes added to each password before hashing, stored with the hash, so equal
  passwords get different hashes.
- **SameSite** – a cookie flag. `Lax` (ours) means the browser does not send the cookie on
  cross-site `POST` requests.
- **Savings Plans** – a lower price in return for committing to a steady amount of compute spend.
  Not used by us.
- **SCP (Service Control Policy)** – an AWS Organizations guardrail that can only take permissions
  away from accounts. Not used by us.
- **Screen reader** – software that reads a page aloud for blind or low-vision users (VoiceOver on
  macOS).
- **Secrets Manager** – AWS's locked safe for passwords and tokens. Every read is checked by IAM.
- **Secure (cookie flag)** – the browser sends the cookie only over HTTPS. On in production.
- **Security group** – a stateful firewall attached to a resource; it lists what is allowed in
  and out. We have five: alb, web, api, db, redis.
- **Seed data** – sample rows a script puts into a fresh database. Ours: `pnpm --filter @minitickets/api db:seed` ([card](concepts/seed-data.md)).
- **Selectivity** – how much of a table a condition keeps. A condition that keeps few rows is selective, and an index helps. If it keeps most rows, a Seq Scan is cheaper.
- **Sequential scan** – Postgres reading every row of a table to find matches; what happens without
  a useful index.
- **Server Component** – a React component rendered only on the server; it sends HTML and no
  component JavaScript to the browser.
- **Server state vs client state** – data owned by the server and cached in the browser (TanStack Query) vs data that exists only in the browser (form fields, `useState`).
- **Server-to-server call** – one server calling another directly, not through a browser. Ours: the web server calls the api to render `/events` ([card](concepts/server-to-server-calls.md)).
- **Service Connect (ECS)** – an ECS feature that gives services private names (like `http://api:4000`) other services can call inside the VPC, through a proxy in each task. Planned ([card](concepts/service-connect.md)).
- **Service container (GitHub Actions)** – a Docker container (like Postgres) that a CI job starts
  next to its steps. Our e2e job uses Postgres 17.6 and Redis 7.4.5.
- **Service (ECS)** – keeps the wanted number of tasks running and replaces failed ones.
- **Service discovery** – how one service finds the current address of another by name, even after tasks are replaced.
- **Service-linked role** – a role AWS creates and owns so a service can act in our account.
- **Session** – the server's memory that a browser is logged in. Ours: a Valkey/Redis key
  `session:<sha256 of the id>` with a 7-day TTL.
- **Session Manager plugin** – the laptop add-on the AWS CLI needs to open ECS Exec sessions.
- **Session token** – the third part of temporary AWS credentials, next to the access key id and
  secret.
- **SHA-256** – a hash function. We store the SHA-256 of the session id, never the id itself.
- **Shield / WAF** – AWS Shield protects against DDoS floods; WAF (web application firewall) blocks bad requests by rules. Not used by us.
- **Sidecar** – a helper container that runs next to the main container in the same task (for example Service Connect's proxy).
- **SIGKILL** – a signal that ends a process at once; it can't be caught. ECS sends it when the app
  hasn't exited `stopTimeout` (default 30 s) after SIGTERM.
- **SIGTERM** – the polite "please stop" signal. Docker and ECS send it before killing a process.
- **SigV4 (Signature Version 4)** – how every AWS API request is signed with the caller's
  credentials.
- **Simple request (CORS)** – a cross-origin request the browser sends without a preflight (GET/POST
  with form-like content types). JSON POSTs are not simple, so they get a preflight.
- **Site (same-site)** – the registrable domain (like `example.com`), ignoring subdomains and ports.
  SameSite cookies are about sites; CORS is about origins.
- **Skeleton (loading)** – grey placeholder shapes shown while data loads, so the page does not jump. Ours: `EventListSkeleton`.
- **SLI / SLO / error budget** – a measured indicator (e.g. % successful requests), the target for it (e.g. 99.9%), and how much failure the target still allows.
- **Sliding expiration** – a session that is extended on each use, so active users stay logged in.
  Ours is fixed: 7 days after login.
- **Slow start (ALB)** – ramps traffic up gradually to a newly registered target. Not used by us.
- **Slug** – a short, lowercase, dash-separated name, e.g. `graceful-shutdown`. Card files and
  anchors use it.
- **SNS** – AWS's notification service (email, SMS, webhooks); alarms usually send to it. Not used
  by us.
- **Spot interruption** – AWS taking Spot capacity back: the task gets SIGTERM and about 2 minutes
  to stop.
- **SQL injection** – an attacker's text being run as SQL. Prevented by parameterized queries.
- **SQLSTATE** – Postgres's five-character error code. `23505` = unique_violation, which
  `queries/users.ts` turns into `ConflictError`.
- **SQS** – AWS's managed message queue. Not used by us.
- **SSE (Server-Sent Events)** – the server pushes a stream of messages to the browser over one HTTP response.
- **ssmmessages** – the AWS Systems Manager channels that ECS Exec uses.
- **SSR (server-side rendering)** – the server fetches the data and sends finished HTML. Ours: `/events` since Step 22, with streaming ([card](concepts/csr-vs-ssr.md)).
- **Stale (TanStack Query)** – a cached answer that may be out of date and will be refetched on the
  next trigger (mount, window focus). With `staleTime` 0 (the default), answers are stale at once.
- **staleTime (TanStack Query)** – how long an answer counts as fresh before it may be refetched. Default 0. Ours: 30 s for `useEvents`, so data from the server is not fetched again.
- **Standalone output (Next.js)** – a build mode that copies only the files the app needs into one small server folder.
- **Stateful firewall** – remembers allowed connections, so replies are allowed automatically.
- **Stateless server** – keeps no user data in its own memory between requests, so any copy can
  answer any request.
- **Static checks** – checks that read code without running it: TypeScript's typecheck and lint.
- **Sticky sessions** – the load balancer keeps sending one client to the same target. Off for us.
- **stopTimeout (ECS)** – seconds between SIGTERM and SIGKILL when ECS stops a container. Default
  30; we don't set it.
- **Streaming (HTML)** – sending one HTTP response in pieces: the first piece leaves before the last is ready. Ours: `/events` sends the frame, then the list ([card](concepts/streaming-suspense.md)).
- **STS (Security Token Service)** – the AWS service that hands out temporary credentials for roles.
- **Subnet** – a slice of the VPC's address range that lives in one AZ.
- **Suspense** – a React component that marks a part of the page that may wait, and shows a fallback (ours: the skeleton) until it is ready.
- **Switch (Pulumi config switch)** – our on/off settings `dataEnabled`, `computeEnabled`,
  `entryEnabled` in `infra/index.ts`, used to save money.
- **Symmetric / asymmetric encryption** – one shared key for both directions / a public key to encrypt and a private key to decrypt. TLS uses both.
- **Synthetic check** – a robot that regularly uses the app (for example, logs in) to detect
  outages. Not built.
- **Systems Manager (SSM)** – an AWS service for managing machines; ECS Exec uses its message
  channels.

## T

- **t4g** – AWS's burstable Graviton machine family. Ours: `db.t4g.micro` (RDS) and
  `cache.t4g.micro` (Valkey).
- **Tailwind CSS** – a CSS framework of small utility classes like `p-4` and `text-sm`.
- **TanStack Query** – the React library that fetches, caches and refetches server data in the browser.
- **Target group** – the ALB's list of task IPs for one kind of request, plus a health check.
- **Task (ECS)** – one running copy of a task definition: our container.
- **Task definition** – the recipe for a task: image, CPU and memory, env vars, secrets, logs,
  health check.
- **Task role** – the IAM role that the **running** container's code uses. Ours allows only ECS Exec.
- **Test isolation** – each test creates its own data and doesn't depend on others. Our e2e tests
  make a new email per run.
- **Testcontainers** – a library that starts real databases in Docker for tests. A way to add our
  missing integration tests.
- **Testing pyramid** – many fast unit tests, fewer integration tests, few slow end-to-end tests.
- **Timeout** – the longest we wait for an answer before giving up.
- **timestamptz** – Postgres's `timestamp with time zone`: stores an exact instant. Our
  `users.created_at`.
- **Timing attack** – learning a secret by measuring how long the server takes to answer. Our login
  runs one argon2 verify for every attempt to avoid it.
- **TLS (Transport Layer Security)** – the encryption under HTTPS, `rediss://` and Postgres SSL.
- **TLS termination** – the place where the encrypted connection ends and is decrypted. For
  browsers that is CloudFront.
- **Top-N heapsort** – the sort method Postgres uses for `ORDER BY … LIMIT N`: it keeps only the best N rows in memory instead of sorting everything. Seen in the no-index plan for `listUpcoming`.
- **Transit gateway** – a hub that joins many VPCs and on-premises networks. Not used by us.
- **Transpile** – convert source code into another form of code (TypeScript → JavaScript). Next.js
  transpiles `@minitickets/shared` because it ships TypeScript.
- **Trivy / Grype** – open-source image vulnerability scanners, often run in CI. Not used by us.
- **tRPC** – a library for calling server functions from the browser with shared TypeScript types.
- **Trust policy** – the resource-based policy on a role that says who may assume it.
- **trustProxy** – the Fastify setting that reads the real visitor IP from `X-Forwarded-For`.
  Ours trusts 2 hops on AWS.
- **TTFB (time to first byte)** – the time from sending a request until the first byte of the answer arrives.
- **TTL (time to live)** – how long a stored value lives before it is deleted automatically.
- **Twelve-factor config** – keep configuration in environment variables, not in the code or the image.
- **Type narrowing** – TypeScript learning a more exact type after a check. `isAuthed` narrows
  `ctx.session` from `{…} | null` to `{…}`.
- **Typecheck** – TypeScript checking the types without running the code (`tsc --noEmit`).

## U

- **Unique constraint** – a database rule that no two rows may share a value. Ours: `users.email`.
- **Unit test** – a small, fast test of one function. Ours use Vitest.
- **User enumeration** – an attacker finding out which emails have accounts, from different answers
  or different response times.
- **useSyncExternalStore** – a React hook for values that live outside React. Its third argument is the value used on the server and during hydration; we use it so `EventDate` renders the same text on both sides.
- **UUID** – a 128-bit random id, hard to guess. Our `users.id`.

## V

- **Valkey** – an open-source fork of Redis that speaks the same protocol. Our AWS session store.
- **Vitest** – our unit test runner.
- **VPC origin (CloudFront)** – CloudFront reaching a private load balancer that has no public
  address. Not used by us.
- **VPC (Virtual Private Cloud)** – our own private network inside AWS. Ours: `10.0.0.0/16`.
- **VPC endpoint** – a private door from the VPC to an AWS service, without the internet. Not built.

## W

- **WebSockets** – a two-way connection between browser and server that stays open.
- **Weighted random** – an ALB algorithm that picks targets randomly, weighted by their health.
- **Workspace (pnpm)** – a set of packages in one repo that depend on each other by name.
  `"workspace:*"` means "use the local copy".

## X

- **x-amz-cf-pop** – a CloudFront response header naming the edge location that answered.
- **X-Amzn-Trace-Id** – a header the ALB adds with a unique id per request. A good base for
  correlation ids (not used yet).
- **x-cache** – a CloudFront response header: `Hit from cloudfront` or `Miss from cloudfront`.
- **X-Forwarded-For (XFF)** – a header each proxy adds, listing who it got the request from.
- **X-Forwarded-Proto** – a header saying which protocol (http or https) the visitor used.
- **X-Origin-Verify** – our secret header from CloudFront to the ALB. See **Origin secret**.
- **XSS (cross-site scripting)** – an attacker's JavaScript running inside our page.

## Z

- **Zero-downtime deploy** – releasing a new version without users seeing errors.
- **Zod** – the library that describes and checks the shape of data (inputs, env vars). Shared
  schemas live in `packages/shared`.
- **Zonal resource** – lives in one AZ (a subnet, an RDS instance, a running task).

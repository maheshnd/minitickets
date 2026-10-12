# The big picture

History: see [CHANGELOG.md](CHANGELOG.md) or run `pnpm docs:history`

**In one line:** MiniTickets is a Next.js web app and a Fastify + tRPC API that share types,
store users in Postgres and sessions in Redis, and run on AWS behind CloudFront and a load balancer.

Today it can sign up, log in, show a private dashboard, log out and list upcoming events
(`/events`, rendered on the server with streaming, not cached yet; its query uses an index on `starts_at`). Booking tickets is not built yet. This page shows the whole system once, then follows one request and one login through it.
Every name below is a real name from the code.

## 1. The whole system today

```mermaid
flowchart TB
    browser["Browser"]
    cf["CloudFront<br/>HTTPS, caches /_next/static/*"]
    alb["ALB :80<br/>/trpc/* → api, rest → web"]
    web["web task<br/>Next.js :3000"]
    api["api task<br/>Fastify + tRPC :4000"]
    rds[("RDS Postgres 17<br/>users, events<br/>(index on starts_at)")]
    valkey[("ElastiCache Valkey<br/>sessions")]
    aws["ECR · Secrets Manager<br/>CloudWatch Logs"]
    ci["GitHub Actions CI<br/>(CD: planned)"]
    browser -->|"https"| cf
    cf -->|"http + X-Origin-Verify"| alb
    alb --> web
    alb --> api
    web -.->|"planned: Service Connect<br/>(SSR of /events)"| api
    api -->|"TLS :5432"| rds
    api -->|"TLS :6379"| valkey
    aws -.->|"image, secrets at start; logs out"| api
    aws -.-> web
    ci -.->|"tests only today"| aws
```

How to read it:

- **Solid arrows** are requests while the app runs. **Dotted arrows** happen around it: ECS pulls
  the image from ECR and reads secrets from Secrets Manager when a task starts, and every log line
  goes to CloudWatch Logs.
- **Planned:** the web task calling the api directly. Locally the web server renders `/events` by
  calling the api itself; on AWS nothing allows web → api yet, so "SSR on AWS" is 🟡
  ([server-to-server-calls](concepts/server-to-server-calls.md), [service-connect](concepts/service-connect.md)).
- **Planned:** continuous deployment. Today CI only checks the code and builds the images
  ([docs/10](../10-ci.md)); images are pushed from a laptop with `pnpm images:push`
  ([docs/16](../16-infra-ecr.md)) and deployed with `pulumi up` by the owner.
- **Switchable:** RDS, Valkey, the tasks, the ALB and CloudFront exist only while their Pulumi
  switches are on (`dataEnabled`, `computeEnabled`, `entryEnabled` in `infra/index.ts`), because
  they cost money every hour. The network, security groups, budget and ECR are always on.
  See [docs/00-architecture](../00-architecture.md) for the detailed AWS diagram.

The same app also runs on a laptop. There, nothing sits in front of the two servers:

```mermaid
flowchart LR
    browser["Browser"] -->|"pages"| web["web :3000<br/>pnpm dev"]
    browser -->|"/trpc, cross-origin<br/>CORS + cookie"| api["api :4000<br/>pnpm dev"]
    web -->|"/events: server to server<br/>API_INTERNAL_URL"| api
    api --> pg[("Postgres<br/>Docker")]
    api --> redis[("Redis<br/>Docker")]
```

| | Laptop (`pnpm dev`) | AWS |
| --- | --- | --- |
| Where the browser sends `/trpc` | `http://localhost:4000/trpc` (another origin, so CORS applies) | `/trpc` on the same origin; the ALB routes it |
| Where the web **server** calls the api (rendering `/events`) | `API_INTERNAL_URL` = `http://localhost:4000` | not possible yet (planned: Service Connect) |
| Session store | Redis 7.4 in Docker | Valkey 8.2 on ElastiCache (Redis-compatible) |
| Database settings | `DATABASE_URL`, no TLS | `DB_HOST` … `DB_PASSWORD`, TLS with a verified certificate |
| Cookie `Secure` flag | off (`NODE_ENV` is not `production`) | on (HTTPS through CloudFront) |
| Proxies trusted by the api | 0 | 2 (CloudFront, then the ALB) |

## 2. The life of one request

A logged-in user opens `https://<id>.cloudfront.net/dashboard` on AWS:

1. The browser opens HTTPS to the nearest CloudFront edge. TLS ends there.
2. CloudFront's default behavior does not cache pages. It forwards the request, cookie included,
   over plain HTTP to the ALB and adds the secret `X-Origin-Verify` header.
3. The ALB's security group lets it in (it comes from CloudFront's IP ranges). Listener rule 200
   sees the secret header and forwards to the web target group.
4. Next.js runs `proxy` in `apps/web/src/proxy.ts`: a `sid` cookie exists, so the page renders.
   `DashboardPage` is HTML from the server; `ProfileCard` is a client component.
5. The browser loads the JavaScript from `/_next/static/*`. CloudFront serves it from its cache when
   it can.
6. `ProfileCard` calls `useProfile`, which asks TanStack Query, which asks the tRPC client for
   `account.profile`. The header's `useMe` asks for `auth.me` at the same moment, and
   `httpBatchLink` can send both in one `GET /trpc/…?batch=1`.
7. CloudFront's `/trpc/*` behavior never caches. ALB rule 100 (secret header + `/trpc/*`) forwards
   to the api target group on port 4000.
8. Fastify reads the real visitor IP (`trustProxy`) and the cookie. `createContext` hashes the
   `sid` and looks up `session:<sha256>` in Valkey.
9. `protectedProcedure` lets the call through, `getProfile` in `services/account.ts` calls
   `findById` in `queries/users.ts`, and Drizzle asks Postgres over TLS.
10. `.output(ProfileSchema)` keeps only `id`, `email`, `createdAt`. The JSON goes back through the
    ALB and CloudFront. TanStack Query caches it and `ProfileCard` shows the email.

A public request takes a different first half: for `/events` the **web server** calls `events.list`
itself (server to server), streams the HTML with the events in it, and the browser reuses that data
without calling the api. The api side is the same three layers, without the session check
([app story: 10b](app-story.md#10b-reading-events)).

## 3. The life of a login request

Three small sequence diagrams instead of one huge one. Together they name every component.

### 3a. From the form to the api's front door

```mermaid
sequenceDiagram
    participant F as LoginForm
    participant H as useLogin (TanStack Query)
    participant T as tRPC client (httpBatchLink)
    participant CF as CloudFront
    participant ALB as ALB listener
    participant API as Fastify (api task)
    F->>F: validate() with shared LoginInput
    F->>H: login.mutate({ email, password })
    H->>T: auth.login mutation
    T->>CF: POST /trpc/auth.login?batch=1 (HTTPS)
    CF->>ALB: same request over HTTP + X-Origin-Verify
    ALB->>API: rule 100 (header + /trpc/*) → api target group :4000
```

- `LoginForm` (`apps/web/src/features/auth/components/login-form.tsx`) runs the same Zod schema
  the server will run, only to give fast feedback.
- Login is a **mutation**, so tRPC sends a `POST`. CloudFront's `/trpc/*` behavior allows `POST`;
  the default (pages) behavior allows only `GET` and `HEAD`.
- Locally there is no CloudFront or ALB: the browser calls `http://localhost:4000` directly, and
  because that is another origin, CORS rules apply (`app.register(cors, …)` in `apps/api/src/app.ts`).

### 3b. Inside the api: from Fastify to the service

```mermaid
sequenceDiagram
    participant API as Fastify
    participant CTX as createContext
    participant EM as errorMapper
    participant P as auth.login procedure
    participant S as authService.login
    API->>API: trustProxy (real IP), cookie plugin
    API->>CTX: build ctx (no sid yet, so session = null)
    CTX->>EM: run the procedure inside errorMapper
    EM->>P: Zod parses input with LoginInput
    P->>S: login({ email, password })
```

- `createContext` (`apps/api/src/trpc/context.ts`) runs for every tRPC request. With no `sid`
  cookie it does not touch Valkey.
- `errorMapper` (`apps/api/src/trpc/init.ts`) wraps every procedure. If the input is invalid, tRPC
  answers 400 and `errorFormatter` adds per-field messages.

### 3c. The service, the stores and the way back

```mermaid
sequenceDiagram
    participant S as authService.login
    participant U as queries/users
    participant PG as RDS Postgres
    participant SE as queries/sessions
    participant V as Valkey
    participant P as auth.login procedure
    S->>U: findByEmail(email)
    U->>PG: SELECT … WHERE "email" = $1 … (TLS)
    PG-->>S: user row (or nothing)
    S->>S: argon2 verify (dummy hash if no user)
    S->>SE: create(user.id)
    SE->>V: SET session:<sha256(id)> … EX 604800 (TLS)
    S-->>P: { user, sessionId }
    P-->>P: setCookie sid (HttpOnly, SameSite=Lax, Secure), .output() keeps id + email
```

- **Equal timing:** `login` in `apps/api/src/services/auth.ts` always runs one argon2 verify, against
  `DUMMY_HASH` when the email is unknown, and answers "Invalid email or password" for both failures.
- **The session:** 32 random bytes become the cookie value. Valkey stores only its SHA-256 hash,
  for 7 days (`SESSION_TTL_SECONDS` = 604800). The cookie's `maxAge` is the same.
- **Back in the browser:** the response carries `Set-Cookie` back through the ALB and CloudFront.
  `useLogin`'s `onSuccess` invalidates the cached `auth.me`, so the header asks again and shows
  "Signed in as …". Then `LoginForm` sends the user to `getSafeNext(next)`, which allows only paths
  on our own site.
- **Wrong password:** the service throws `UnauthorizedError`, `errorMapper` turns it into tRPC
  `UNAUTHORIZED`, the browser gets HTTP 401, and the form shows the message under the button.

## 4. Components

Every AWS piece that is built today, with the card that explains it. `pnpm docs:check` fails if a
✅ AWS card is missing from this table.

| Component | Area | What it does for us | Card |
| --- | --- | --- | --- |
| CloudFront distribution | AWS Network | The public HTTPS front door | [`cloudfront`](concepts/cloudfront.md) |
| ALB, listener and rules | AWS Network | Routes `/trpc/*` to api, the rest to web | [`alb`](concepts/alb.md) |
| Target groups | AWS Network | The lists of healthy task IPs per service | [`target-groups`](concepts/target-groups.md) |
| VPC | AWS Network | The private network everything lives in | [`vpc`](concepts/vpc.md) |
| Subnets (public and private) | AWS Network | The floors of the VPC | [`subnets`](concepts/subnets.md) |
| Route tables and internet gateway | AWS Network | Where each subnet's traffic goes | [`route-tables`](concepts/route-tables.md) |
| Security groups | AWS Network | Stateful firewalls between the pieces | [`security-groups`](concepts/security-groups.md) |
| Regions and availability zones | AWS Network | Where the resources physically run | [`regions-and-azs`](concepts/regions-and-azs.md) |
| Origin protection (prefix list + secret header) | AWS Network | Only CloudFront may reach the ALB | [`origin-protection`](concepts/origin-protection.md) |
| Same-origin path routing | AWS Network | One public host for pages and `/trpc` | [`same-origin-routing`](concepts/same-origin-routing.md) |
| TLS termination | AWS Network | Where HTTPS ends (CloudFront; plain HTTP to the ALB) | [`tls-termination`](concepts/tls-termination.md) |
| ECS cluster and capacity providers | AWS Compute | The group that tasks run in | [`ecs-cluster`](concepts/ecs-cluster.md) |
| ECS service | AWS Compute | Keeps the desired number of tasks running | [`ecs-service`](concepts/ecs-service.md) |
| Task definition | AWS Compute | The recipe for a task | [`task-definition`](concepts/task-definition.md) |
| Fargate | AWS Compute | Runs containers with no servers to manage | [`fargate`](concepts/fargate.md) |
| Fargate Spot | AWS Compute | Cheap spare capacity that AWS can take back | [`fargate-spot`](concepts/fargate-spot.md) |
| ARM64 (Graviton) tasks | AWS Compute | The CPU type of the images and tasks | [`arm64-graviton`](concepts/arm64-graviton.md) |
| Execution role and task role | AWS Compute | IAM roles for ECS and for our code | [`execution-vs-task-role`](concepts/execution-vs-task-role.md) |
| ECS Exec | AWS Compute | A shell inside a running task | [`ecs-exec`](concepts/ecs-exec.md) |
| ECR repositories | AWS Compute | Where the Docker images are stored | [`ecr`](concepts/ecr.md) |
| RDS Postgres instance | AWS Data | The database for users | [`rds-postgres`](concepts/rds-postgres.md) |
| RDS-managed master password | AWS Data | The database password kept in Secrets Manager | [`rds-managed-password`](concepts/rds-managed-password.md) |
| Secrets Manager secrets | AWS Data | Passwords and tokens injected at task start | [`secrets-manager`](concepts/secrets-manager.md) |
| ElastiCache Valkey | AWS Data | The session store | [`elasticache-valkey`](concepts/elasticache-valkey.md) |

## How this connects

- **Uses:** the step docs, especially [07 login](../07-login-session.md),
  [18 ALB](../18-infra-alb-web.md) and [19 CloudFront](../19-infra-cloudfront.md).
- **Gives:** the frame for everything else. [aws-foundations.md](aws-foundations.md) explains the
  AWS rules these arrows obey. The [infra story](infra-story.md) and the [app story](app-story.md) walk the same
  path chapter by chapter. The [concept map](concept-map.md) lists every concept named here.

# Interview drills

History: see [CHANGELOG.md](CHANGELOG.md) or run `pnpm docs:history`

Use [interview mode](guides/scenarios.html?mode=interview) to hide answers and save quiz progress. For each question, answer in 30 seconds, name its source boundary, explain a failure and defend an alternative. Built is repository/local evidence; AWS acceptance is separate.

## Frontend round

- **built**: [typing "a" then "ap" in search: can the old response override the new one?](guides/interview-scenarios.md#search-races). Counter-question: Could filters race too? Yes: venue/date/cursor must be in the input key. Should previous rows be bookable? Recheck authoritative availability on booking.
- **built**: [When do you debounce, throttle or cancel?](guides/interview-scenarios.md#debounce-throttle). Counter-question: Can a malicious client skip it? Yes. Server validation and limits remain necessary.
- **built**: [rendering 10k events](guides/interview-scenarios.md#virtual-lists). Counter-question: Does virtualization reduce SQL rows scanned? No; indexes and pagination do that.
- **partly**: [SSR, CSR or static rendering for an event catalogue?](guides/interview-scenarios.md#rendering-models). Counter-question: Does dynamic HTML forbid cached data? No. Cache only public results with complete keys.
- **built**: [Why do hydration mismatches happen?](guides/interview-scenarios.md#hydration). Counter-question: Why not generate a random id during render? Server and client may generate different values.
- **built**: [caching Next pages that must not be shared (Next server, CloudFront)](guides/interview-scenarios.md#private-page-cache). Counter-question: Does Vary: Cookie make every policy safe? No; the CDN cache key and minimum TTL must also agree.
- **built**: [how to check LCP and other vitals](guides/interview-scenarios.md#web-vitals). Counter-question: Why no INP on a page never touched? It needs qualifying interactions.
- **partly**: [How do you keep JavaScript bundles small?](guides/interview-scenarios.md#bundle-size). Counter-question: Does importing a type run API initialization? No; TypeScript erases that import.
- **partly**: [Should buying the last seat use optimistic UI?](guides/interview-scenarios.md#optimistic-ui). Counter-question: Can pending QR trigger rebooking? No; poll ticket readiness for the existing booking.
- **built**: [What do axe checks prove, and what do they miss?](guides/interview-scenarios.md#accessibility). Counter-question: Does zero axe violations certify accessibility? No.
- **explain-only**: [P9: how would live seats work with SSE, WebSockets or polling?](guides/interview-scenarios.md#live-seats). Counter-question: How recover a missed pub/sub message? Reload an authoritative snapshot; do not infer availability from a gap.
- **explain-only**: [P11: where would Lighthouse CI fit?](guides/interview-scenarios.md#lighthouse). Counter-question: Can a good lab score prove p75 field INP? No; real interactions and device populations differ.

## Backend round

- **built**: [many requests at the same time: how does the DB handle it?](guides/interview-scenarios.md#database-concurrency). Counter-question: Can two different events run together? Yes, unless another shared resource bottlenecks.
- **built**: [no cache and many requests: how to lock and get the latest?](guides/interview-scenarios.md#locking-latest). Counter-question: Is Redis SET NX sufficient? No; lease expiry/restart can allow multiple holders.
- **built**: [idempotency](guides/interview-scenarios.md#idempotency). Counter-question: Why scope by user? Two users may coincidentally submit the same client key without sharing a booking.
- **built**: [How do retries avoid amplifying an outage?](guides/interview-scenarios.md#retry-backoff). Counter-question: What if the response is lost after send? A retry may duplicate delivery; the consumer must be idempotent.
- **partly**: [Pool exhaustion, timeouts and circuit breakers: where are the boundaries?](guides/interview-scenarios.md#timeouts-pools). Counter-question: Does a timeout prove rollback? No; retry with idempotency and reconcile ambiguous results.
- **built**: [Why token buckets, and which identity do you limit?](guides/interview-scenarios.md#rate-limits). Counter-question: Should auth failures all share one user key? No; unauthenticated identity needs a trusted edge/IP policy.
- **built**: [API design, N+1 and graceful shutdown](guides/interview-scenarios.md#api-n-plus-one). Counter-question: Can the web import the API database module? No; only its router type crosses that boundary.

## Database round

- **partly**: [how Postgres caches](guides/interview-scenarios.md#postgres-cache). Counter-question: Does a shared-buffer hit skip SQL execution? No.
- **built**: [GIN, B-tree, EXPLAIN and keyset versus OFFSET](guides/interview-scenarios.md#indexes-pagination). Counter-question: Why carry id with time? It breaks ties so rows sharing a timestamp are not skipped.
- **partly**: [How do migrations and rollback avoid downtime?](guides/interview-scenarios.md#migrations). Counter-question: Can rollback remove a column safely? Only if no running version uses it and recovery is planned.
- **explain-only**: [Read replicas, multi-AZ and backups/PITR: which problem does each solve?](guides/interview-scenarios.md#replicas-backups). Counter-question: Can a replica stop accidental deletion? No; deletion replicates.

## Caching round

- **built**: [How do you stop a cache miss stampede across instances?](guides/interview-scenarios.md#cache-stampede). Counter-question: Why random owner token? A late old holder must not delete a newer lease.
- **built**: [How do you prevent a stale refill after a write?](guides/interview-scenarios.md#cache-invalidation). Counter-question: Why read generation before SQL? Reading after SQL could place old rows in the new generation.
- **built**: [SWR, stale-if-error and stacked caches: how stale can a user see?](guides/interview-scenarios.md#swr-caches). Counter-question: Does a successful admin write refresh all open tabs? No; they refetch on their own query policy.
- **partly**: [How do hot keys, cache keys and privacy interact?](guides/interview-scenarios.md#hot-keys-privacy). Counter-question: Is hashing a key encryption? No; do not put secrets into it assuming privacy.

## Async round

- **built**: [What if booking commits but publishing fails?](guides/interview-scenarios.md#outbox). Counter-question: What if SNS accepted before relay crash? Publish again with stable message identity; consumers deduplicate.
- **built**: [Queue, topic, event bus or Kafka for booking events?](guides/interview-scenarios.md#fanout). Counter-question: Why not two Lambdas on one SQS queue? They compete; each message is not promised to both.
- **built**: [Can an idempotent email consumer guarantee exactly one email?](guides/interview-scenarios.md#consumer-idempotency). Counter-question: Why not use queue message id for tickets? Republishing the same booking can create a different queue id.
- **built**: [A customer has no confirmation: retry, DLQ or redrive?](guides/interview-scenarios.md#dlq-failure). Counter-question: Does an empty queue mean email was delivered? No; inspect completion/provider outcomes too.
- **explain-only**: [What if ordering matters or a multi-step purchase needs compensation?](guides/interview-scenarios.md#ordering-sagas). Counter-question: Is refund identical to undoing history? No; it is a new durable transaction.
- **explain-only**: [P5: where would scheduled reminders go in MiniTickets?](guides/interview-scenarios.md#reminders). Counter-question: What if the schedule runs twice? Dedup by stable reminder identity, not invocation id.

## Sale day round

- **built**: [sale day with row locks.](guides/interview-scenarios.md#sale-day). Counter-question: Can reconciliation blindly SET database stock? No; compare-and-set against an observed version to avoid clobbering in-flight debits.
- **explain-only**: [Where would a waiting room, booking queue and expiring seat holds go?](guides/interview-scenarios.md#waiting-room). Counter-question: What if expiry races payment? One conditional state transition wins; reconcile external payment/refund.
- **explain-only**: [P8: how would ECS autoscaling help, and what would it cost?](guides/interview-scenarios.md#autoscaling). Counter-question: Why not just set max 100? Cost, DB connection limits and downstream saturation.

## AWS round

- **partly**: [ECS, Lambda or EKS? Cold starts, VPC and NAT?](guides/interview-scenarios.md#compute-choices). Counter-question: Is a Lambda in a public subnet publicly addressed? No.
- **built**: [IAM roles and OIDC: who can wear which badge?](guides/interview-scenarios.md#iam-oidc). Counter-question: Why did worker publish need BatchGetImage? Publishing tooling reads image manifests as well as uploading layers.
- **built**: [Routes, SGs, NACLs, ENIs and private DNS: what actually connects?](guides/interview-scenarios.md#network-boundaries). Counter-question: Can browser JS call the Service Connect hostname? No; it is private service discovery for tasks.
- **built**: [How do access patterns choose DynamoDB keys?](guides/interview-scenarios.md#dynamodb). Counter-question: Can a caller choose another ownerId? No; take it from the verified session.
- **partly**: [SES deliverability, quotas and duplicate emails](guides/interview-scenarios.md#ses-email). Counter-question: Does more Lambda concurrency increase SES quota? No.
- **explain-only**: [Multi-AZ, multi-region and cost: how far should this project go?](guides/interview-scenarios.md#regions-cost). Counter-question: Does a second AZ guarantee two healthy tasks? No; desired counts and dependencies matter.

## Security round

- **built**: [Presigned URLs, CORS and untrusted uploads](guides/interview-scenarios.md#presigned-uploads). Counter-question: Can another origin with curl use a leaked URL? Yes; CORS does not constrain non-browser callers.
- **explain-only**: [P6: where would door check-in go in MiniTickets?](guides/interview-scenarios.md#door-checkin). Counter-question: Can two valid scans both succeed? Only if the storage transition is not conditional or checks different identities.
- **built**: [Sessions versus JWTs, rotation, revocation and roles](guides/interview-scenarios.md#sessions-roles). Counter-question: Is the presence cookie authorization? No; it only avoids a predictable redirect flash; API verifies the real session.
- **built**: [CSRF, CORS, SameSite and trusted headers](guides/interview-scenarios.md#csrf-cors). Counter-question: Is Origin cryptographic API authentication? No; non-browser clients can set it. Sessions still authorize actions.
- **built**: [Nonce CSP, XSS and supply-chain gates](guides/interview-scenarios.md#csp-xss). Counter-question: Why not enable unsafe-eval to silence Zod? Disable the optional JIT/probe instead, preserving production policy.
- **partly**: [Secrets, ticket forgery, rotation and OWASP checks](guides/interview-scenarios.md#secrets-forgery). Counter-question: Are signed QR claims private? No; base64url is readable.

## Delivery round

- **built**: [How does build-once delivery and rollback work?](guides/interview-scenarios.md#delivery-rollback). Counter-question: Should rollback run old Pulumi code? No; image rollback and infrastructure rollback are different risks.
- **built**: [An old approved pipeline would delete new resources: how do you prevent it?](guides/interview-scenarios.md#old-deploy). Counter-question: Why not just cancel pending runs? Human approval and queued concurrency can still select an obsolete run.
- **built**: [How do you debug one booking and avoid alert fatigue?](guides/interview-scenarios.md#observability). Counter-question: Why validate client correlation ids? Prevent log injection and unbounded junk while preserving useful propagation.
- **explain-only**: [Where would tracing, SLOs and error budgets fit?](guides/interview-scenarios.md#tracing-slos). Counter-question: Does 99.5% mean zero failures? No; it allows 0.5% of valid events to miss the objective.
- **built**: [How do you onboard a developer and keep local/cloud parity?](guides/interview-scenarios.md#dev-parity). Counter-question: Why not call the script doctor? pnpm has a built-in command with that name that shadowed it.
- **built**: [Which tests prove correctness, and which need real infrastructure?](guides/interview-scenarios.md#testing-strategy). Counter-question: Does local green mean IAM correct? No; only AWS evaluates the deployed policies.
- **partly**: [Feature flags, rolling versus blue/green and incident rollback](guides/interview-scenarios.md#feature-flags). Counter-question: Is cdnEnabled a per-user product flag? No; it changes the infrastructure graph.

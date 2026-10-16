# System design rounds

History: see [CHANGELOG.md](CHANGELOG.md) or run `pnpm docs:history`

Start with the existing invariant and measured bottleneck. A proposal below is a design extension, not a claim it is implemented. The linked scenarios carry source and diagram evidence.

## Handle an on-sale spike

**Current state:** One event row serializes buyers even with many API tasks. Rate limits bound callers; an advisory Redis inventory gate rejects obvious sold-out work before the database. All admitted buyers still run the same Postgres transaction. Redis failure, expiry or wrong counts must never create a confirmed seat by itself.

**Bottleneck / invariant:** Fewer doomed buyers enter the hot-row queue.

**Proposed design at scale:** 10x: compare p95/p99 and lock waits. 100x: durable queue admission or partitioned seat rows, keeping DB constraints.

**Trade-offs:** Unknown DB commit/refund and worker crashes can skew the hint; reconciliation repairs admission, not correctness. This is not a customer-visible timed seat hold.

**What to measure:** validate correctness first, then p95/p99 latency, backlog/pool/lock pressure and cost for the named path; do not extrapolate a local demo into production capacity.

[Source and scenario](guides/interview-scenarios.md#sale-day) · [Tour](guides/infra-explorer.html?tour=sale-day).

## Scale login and revoke devices

**Current state:** Opaque session cookies keep revocation server-side; JWTs reduce lookup dependence but revocation/role changes need expiry or another authoritative version. MiniTickets hashes random tokens in Redis, rotates login sessions, indexes at most 20 devices and checks membership on every read. Admin authorization reads Postgres; role changes revoke sessions before and after the update.

**Bottleneck / invariant:** A role embedded forever in a session becomes stale after a privilege change.

**Proposed design at scale:** 10x: monitor auth-store failures and session churn. 100x: coordinated auth versioning, device management and key/credential rotation.

**Trade-offs:** Redis/index eviction fails closed and forces login. The 20-device bound makes revoke work bounded. Session-versioning/transactional role changes are proposed improvements for larger deployments.

**What to measure:** validate correctness first, then p95/p99 latency, backlog/pool/lock pressure and cost for the named path; do not extrapolate a local demo into production capacity.

[Source and scenario](guides/interview-scenarios.md#sessions-roles) · [Tour](guides/infra-explorer.html?tour=security-layers).

## Cache a changing public catalogue

**Current state:** Commit the write, then increment a cache generation. A reader captures the generation before its database read and stores only under that generation. A slow pre-write reader can fill its old key, but new readers use the new generation. TTL bounds stale data if invalidation fails; errors are logged instead of undoing a committed event.

**Bottleneck / invariant:** DEL alone allows an in-flight old reader to repopulate the same key.

**Proposed design at scale:** 10x: watch invalidation failures/key churn. 100x: outbox-driven invalidation and explicit freshness SLOs.

**Trade-offs:** Generation keys increase transient cardinality. Redis and Next/browser caches have separate stale windows; one invalidation does not instantly refresh every tab.

**What to measure:** validate correctness first, then p95/p99 latency, backlog/pool/lock pressure and cost for the named path; do not extrapolate a local demo into production capacity.

[Source and scenario](guides/interview-scenarios.md#cache-invalidation) · [Tour](guides/infra-explorer.html?tour=search).

## Search a million events

**Current state:** Choose an index for the predicate and order. Trigram GIN helps contains search; B-tree on starts_at/id supports stable traversal. Keyset asks for rows after the last pair, avoiding a growing OFFSET scan. A stable cutoff prevents time drift but is not a database snapshot: inserts and edits can still change later pages.

**Bottleneck / invariant:** Deep OFFSET discards earlier rows repeatedly.

**Proposed design at scale:** 10x: inspect real selectivity and buffers. 100x: retention/partitioning or full-text relevance when product needs it.

**Trade-offs:** GIN adds write/storage cost and short/unselective terms can favor a scan. Keyset cannot jump to arbitrary page 200; snapshot semantics need more design.

**What to measure:** validate correctness first, then p95/p99 latency, backlog/pool/lock pressure and cost for the named path; do not extrapolate a local demo into production capacity.

[Source and scenario](guides/interview-scenarios.md#indexes-pagination) · [Tour](guides/infra-explorer.html?tour=search).

## Deliver every confirmation eventually

**Current state:** Store the booking, seat decrement and confirmation payload in one Postgres transaction. A relay publishes committed outbox rows and marks them sent. A crash after publish but before marking sent produces a duplicate, so consumers stay idempotent. This closes message loss, not exactly-once delivery.

**Bottleneck / invariant:** Commit-then-send has a gap; send-then-commit can announce a rolled-back purchase.

**Proposed design at scale:** 10x: batch sends/backlog age. 100x: separate relay or CDC, retention and publish throughput budgets.

**Trade-offs:** Holding row locks while sending is simple but occupies a pool connection. Leases/CDC decouple IO at greater complexity. Sent rows need retention planning.

**What to measure:** validate correctness first, then p95/p99 latency, backlog/pool/lock pressure and cost for the named path; do not extrapolate a local demo into production capacity.

[Source and scenario](guides/interview-scenarios.md#outbox) · [Tour](guides/infra-explorer.html?tour=booking).

## Issue downloadable tickets safely

**Current state:** A presigned URL is a short-lived bearer capability with exactly the signer’s allowed action. CORS controls browser cross-origin use, not authorization. Validate the owner/admin before signing, constrain type/size, inspect actual image bytes and publish to an immutable key with conditional version identity. Never treat a declared Content-Type as malware scanning.

**Bottleneck / invariant:** Direct uploads avoid buffering large files through the API while retaining controlled publication.

**Proposed design at scale:** 10x: upload quotas and cleanup. 100x: scan/re-encode queues, retention and abuse response.

**Trade-offs:** A leaked URL works until expiry. Exact PUT length differs from POST length ranges. Proposed scanning worker belongs before publication and must quarantine failures.

**What to measure:** validate correctness first, then p95/p99 latency, backlog/pool/lock pressure and cost for the named path; do not extrapolate a local demo into production capacity.

[Source and scenario](guides/interview-scenarios.md#presigned-uploads) · [Tour](guides/infra-explorer.html?tour=booking).

## Deploy without incompatible schema overlap

**Current state:** Run migrations once from the same published SHA before rolling tasks. Prefer expand/contract: add compatible schema, deploy readers/writers, backfill, then remove old columns in a later release. Application rollback must not assume a destructive migration can be undone. MiniTickets runs a dedicated migration task; full zero-downtime backfill orchestration is explain-only.

**Bottleneck / invariant:** Old and new tasks overlap during rolling deployment.

**Proposed design at scale:** 10x: inspect lock duration on a copy. 100x: online index/backfill tooling, compatibility windows and rehearsed restore.

**Trade-offs:** CREATE INDEX CONCURRENTLY has transaction restrictions. Long locks can stall traffic. A forward fix may be safer than rolling back code after incompatible data changes.

**What to measure:** validate correctness first, then p95/p99 latency, backlog/pool/lock pressure and cost for the named path; do not extrapolate a local demo into production capacity.

[Source and scenario](guides/interview-scenarios.md#migrations) · [Tour](guides/infra-explorer.html?tour=deploy).

## Debug a missing confirmation

**Current state:** Use a validated correlation id across request, outbox and worker. Logs explain events, metrics show rates and traces time causal steps. Alarm on symptoms: API errors, old queue work, DLQ messages and worker failures. Missing data semantics matter; do not page on every idle CPU wobble.

**Bottleneck / invariant:** A user symptom spans asynchronous boundaries, not one process log.

**Proposed design at scale:** 10x: error rates/p99 and sampling. 100x: SLO burn-rate alerting and trace sampling with explicit budgets.

**Trade-offs:** Correlation is not a timed trace. Logging full messages leaks PII. Fixed thresholds are simple but need traffic-aware tuning and retention cost planning.

**What to measure:** validate correctness first, then p95/p99 latency, backlog/pool/lock pressure and cost for the named path; do not extrapolate a local demo into production capacity.

[Source and scenario](guides/interview-scenarios.md#observability) · [Tour](guides/infra-explorer.html?tour=failing-email).

## Add multi-region recovery

**Current state:** Define availability, recovery time, data loss and budget before adding regions. Two subnets/AZs alone do not make a single-task/single-database dev stack highly available. Multi-region scarce inventory requires a single write owner or a deliberate consistency protocol. Cost includes idle databases, task hours, IPs, endpoints, logs and data transfer.

**Bottleneck / invariant:** Extra copies without failover semantics can create inconsistency and bills.

**Proposed design at scale:** 10x: right-size and test AZ failure. 100x: explicit regional ownership and capacity planning with measured SLOs.

**Trade-offs:** RTO/RPO distinguish recovery time/data loss. Strong global consistency raises latency; regional allocation can sell out unevenly. Cost budgets alert; they do not impose a hard spend cap.

**What to measure:** validate correctness first, then p95/p99 latency, backlog/pool/lock pressure and cost for the named path; do not extrapolate a local demo into production capacity.

[Source and scenario](guides/interview-scenarios.md#regions-cost) · [Tour](guides/infra-explorer.html?tour=build-order).

## Build one-time door admission

**Current state:** Authenticate the staff/device, verify the signed QR claims and conditionally transition a canonical ticket from unused to used. Two scanners race: exactly one conditional update wins. API Gateway REST usage plans/API keys can meter devices, but keys are not user authentication and quotas are best-effort. Reject replay, wrong event and invalid signatures.

**Bottleneck / invariant:** HMAC proves issuance; it cannot stop the same valid QR being shown twice.

**Proposed design at scale:** 10x: per-gate quotas and burst tests. 100x: regional ownership, key revocation and offline conflict procedure.

**Trade-offs:** Offline scanners need a reconciliation/conflict policy and cannot promise global one-time use. API keys leak and are not authorization. Rate limits supplement device/staff identity.

**What to measure:** validate correctness first, then p95/p99 latency, backlog/pool/lock pressure and cost for the named path; do not extrapolate a local demo into production capacity.

[Source and scenario](guides/interview-scenarios.md#door-checkin) · [Tour](guides/infra-explorer.html?tour=check-in).

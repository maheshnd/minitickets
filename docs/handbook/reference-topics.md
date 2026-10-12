# Reference topics (checklist for the concept map; not complete)

History: see [CHANGELOG.md](CHANGELOG.md) or run `pnpm docs:history`

## APIs & protocols
REST, statelessness, GraphQL (over/under-fetching), gRPC, WebSockets,
long polling, HTTP/1.1 vs HTTP/2 vs HTTP/3, HTTP methods, idempotency,
status codes, CORS, API gateway, reverse proxy

## Databases
SQL vs NoSQL, ACID, BASE, CAP theorem, indexing (B-tree), N+1 queries,
connection pooling, normalization/denormalization, replication
(primary/replica), sharding vs partitioning, safe migrations
(expand-and-contract), race conditions, isolation levels, locking
(pessimistic/optimistic)

## Auth & security
sessions vs JWT, OAuth 2.0 (authorization code + PKCE), OIDC,
authentication vs authorization, RBAC, ABAC, password hashing
(bcrypt/argon2id), SQL injection, CSRF, rate limiting (token bucket,
leaky bucket, fixed/sliding window), symmetric vs asymmetric encryption

## Caching & performance
cache-aside, read-through, write-through, write-behind, TTL, LRU,
cache invalidation, cache stampede / thundering herd, CDN caching

## Async & events
message queues, event-driven architecture, RabbitMQ vs Kafka, DLQ,
event sourcing, CQRS, saga pattern, eventual consistency

## Reliability & scale
vertical vs horizontal scaling, load balancing algorithms (round robin,
least connections, IP hash), circuit breaker, graceful shutdown,
monolith vs microservices

## Observability
structured JSON logs, correlation IDs, distributed tracing,
metrics, OpenTelemetry
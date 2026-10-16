# ADR 0009: Locked booking transaction with a durable per-user intent key

History: see [CHANGELOG.md](../CHANGELOG.md) or run `pnpm docs:history`

Status: accepted for repository implementation; live AWS acceptance remains separate.

## Context

A network failure cannot tell a caller whether commit happened. A retry repeats one intent rather than making another purchase. The browser creates one UUID per intent and keeps it for ambiguous retries. A unique user/key constraint stores identity with the booking transaction. Same input replays the booking; different input with the same key conflicts. Failed transactions store no success.

## Picture the boundary

```mermaid
flowchart LR
    n0["One intent key"] --> n1
    n1["Unique database constraint"] --> n2
    n2["Commit once"] --> n3
    n3["Replay same booking"]
```

## Options considered

Read/check/write; conditional UPDATE; explicit FOR UPDATE; Redis idempotency keys.

## Decision

Use FOR UPDATE for readable locked error decisions, relative seat decrement and CHECK, and UNIQUE user/key in the same transaction. Query-layer rule checks are a deliberate exception because they require the locked row. Service compares replay payload; browser retries retain one key.

## Consequences

Redis TTL keys add a cross-store gap and can expire/evict. A generic response store can replay exact response bodies but adds retention rules. This app reconstructs successful responses and keeps keys with bookings.

## When we would revisit

10x: index/storage retention policy. 100x: explicit idempotency contract for payment providers and async intents.

## Evidence and connections

`apps/api/src/db/schema/bookings.ts` enforces unique user/idempotency key. `apps/api/src/services/bookings.ts` compares event and quantity on replay; `queries/bookings.ts` handles races across different event rows. `pnpm demo:idempotency` exercises lost responses and concurrent duplicates.

[Scenario](../guides/interview-scenarios.md#idempotency) · [Tour](../guides/infra-explorer.html?tour=booking)

# Transactional outbox

History: see [CHANGELOG.md](../CHANGELOG.md) or run `pnpm docs:history`

Area: Async · Status: 📋 (code built in P3; teaching card deferred to D3)

This is the series' permitted anchor stub. Booking, seats and the confirmation message commit in
one Postgres transaction. API relays lock small batches with `FOR UPDATE SKIP LOCKED`, publish,
then mark sent. A crash after publish can cause a duplicate; the worker uses the same message id
to recognise it. See the P3 entry in [PENDING.md](../PENDING.md) for measurements and trade-offs.

## 4. Where in our code

- Anchor: `apps/api/src/db/schema/outbox.ts` — the durable message and partial pending index.
- Anchor: `apps/api/src/queries/bookings.ts` — `createBookingTx` saves the confirmation atomically.
- Anchor: `apps/api/src/queries/outbox.ts` — `deliverBatch` holds row locks through send and mark.
- Anchor: `apps/api/src/services/outbox.ts` — `relayOnce`, `startOutboxRelay`, `retryInMs`.

## Where it appears in the story

Story placement and the full card are deferred to the D3 handbook catch-up.

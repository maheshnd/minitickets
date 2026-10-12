# Pending for the next handbook catch-up

One entry per feature step whose docs are not written yet. The catch-up step turns these into step
docs, cards, story chapters and a CHANGELOG entry, then clears this list (see CLAUDE.md, "Workflow").

---

- **Step:** Feature 1, Step 5: cache stampede protection for `events.list` (would be `docs/25-*`).
- **Concepts:** cache stampede (many misses → many identical DB queries); single-flight (in-process, shares one promise; cleanup on success AND error); distributed lock in Redis (`SET NX PX` + random token, release via Lua compare-and-delete); double-check after taking the lock; bounded wait + fallback; lock limits (TTL expiry, Redis restart → extra query) and why that's fine for a cache but never for seats (two holders = double-sold seat; seats need DB guarantees). Also new: `LOG_LEVEL` env var.
- **Key files:** `apps/api/src/services/single-flight.ts` `singleFlight`; `services/events.ts` `listUpcomingEvents`, `rebuild`, `waitForCache`, `recheckCache`, `releaseLock`; `queries/events-cache.ts` `tryLockUpcomingRebuild`, `releaseUpcomingRebuildLock` (`RELEASE_IF_OWNER`); `queries/events.ts` `listUpcoming` (debug line); `config/env.ts` `LOG_LEVEL`; `scripts/stampede-demo.ts` (`pnpm demo:stampede`, RESP `DEL` over `node:net`).
- **Measured (local, 2026-10-12, DB queries = "db query" debug lines):** before fix: 1 instance × 100 req → **100** (2/2 runs). Level 1: 1 × 100 → **1** (3/3); 2 instances × 50 → **2** (3/3). Level 1+2 without double-check: 2 × 50 → 1 or **2** (2 of 5 runs gave 2). Level 1+2 with double-check: 1 × 100 → **1** (3/3); 2 × 50 → **1** (10/10), no warnings. All responses 200; waiting instance's max ≈ 65 ms (one 50 ms re-check).
- **Unsure / for the docs:** the Lua script is only unit-tested against a fake; it was checked by hand on the real Redis (wrong token → 0, key kept; right token → 1). Wait settings (5 × 50 ms, lock TTL 5 s) are judgement calls, not measured under real load. A waiter whose holder is slow still reads Postgres after ~250 ms.

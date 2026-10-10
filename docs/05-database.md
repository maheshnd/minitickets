# Step 5: Database (Postgres + Drizzle)

This step adds the database foundation. There is no signup API yet. We only set up
Postgres, a `users` table, health checks, and a clean shutdown.

## What Docker Compose does here

`docker-compose.yml` starts a real Postgres server inside a container, so you do not
install Postgres on your Mac.

- **Pinned version** (`postgres:17.6`): everyone gets the same Postgres.
- **Named volume** (`postgres_data`): the data is stored outside the container.
  `pnpm db:down` removes the container, but your data stays. (To wipe it, run
  `docker compose down -v`.)
- **Healthcheck**: Docker runs `pg_isready` every few seconds. The container is
  "healthy" only when Postgres really accepts connections. `pnpm db:up` waits for that.
- **Credentials** come from the root `.env` (copy `.env.example`). The same values must
  appear in `DATABASE_URL` inside `apps/api/.env`.

Commands: `pnpm db:up` starts it, `pnpm db:down` stops it.

## Connection pooling

Opening a database connection is slow (network, login). Doing it for every request would
make the API slow. A **pool** opens a few connections once and lends them out:

1. A query asks the pool for a connection.
2. It runs, then gives the connection back.
3. The next query reuses it.

`max: 10` in `src/db/client.ts` caps the pool at 10 connections. Postgres allows only
about 100 connections in total, so each app must stay polite. If all 10 are busy, extra
queries wait in line.

The pool also emits an `error` event when an idle connection dies (for example, the
database restarts). Node crashes on an `error` event nobody listens to, so we log it. The
pool then opens a fresh connection on the next query and the API recovers by itself.

## Migrations, not push

The `users` table is described in TypeScript (`src/db/schema/users.ts`). Two ways exist
to get that into the database:

- **`drizzle-kit push`** compares your code to the database and changes it directly.
  Fast, but it leaves no record, you cannot review it, and you cannot repeat it on another
  machine. We do **not** use it.
- **Migrations** (what we use): `pnpm db:generate` writes a SQL file in `apps/api/drizzle/`.
  `pnpm db:migrate` runs the files that have not run yet.

**Why the migration files are committed:** they are the history of your database. A
teammate, a test machine, or production runs the same files in the same order and ends up
with the same tables. You can also read a migration in code review before it touches any
data.

Workflow: change the schema file → `pnpm db:generate` → read the new SQL → commit it →
`pnpm db:migrate` (from `apps/api`, or `pnpm --filter @minitickets/api db:migrate`).

## Liveness vs readiness

Two different questions, two routes:

| Route | Question | Checks DB? | Answer |
| --- | --- | --- | --- |
| `GET /health` | Is the process alive? | No | Always 200 while the server runs |
| `GET /ready` | Can it do real work now? | Yes (`select 1`) | 200 if the DB answers, 503 if not |

Why separate them? If the database goes down, restarting the API would not help. So
`/health` stays 200 (do not restart me), while `/ready` returns 503 (do not send me
traffic yet). When the database comes back, `/ready` returns 200 again on its own.

## Graceful shutdown

When you press Ctrl+C (SIGINT) or the system sends SIGTERM, `server.ts` does this in order:

1. `app.close()`: stop accepting new requests and let running ones finish.
2. `pool.end()`: close the database connections. This comes second because running
   requests may still need the database.
3. Exit with code 0.

Without this, the process would die in the middle of requests, and Postgres would be left
with connections it has to clean up.

## Files added or changed

- `docker-compose.yml`, `.env.example` (root)
- `apps/api/src/config/env.ts`: validates `DATABASE_URL`
- `apps/api/src/db/client.ts`: the pool and the Drizzle instance
- `apps/api/src/db/schema/users.ts`: the `users` table
- `apps/api/drizzle.config.ts`, `apps/api/drizzle/`: drizzle-kit config and migrations
- `apps/api/src/queries/users.ts`: `findByEmail`, `create` (not used by any procedure yet)
- `apps/api/src/queries/health.ts`: `pingDb` for `/ready`
- `apps/api/src/app.ts`, `apps/api/src/server.ts`: `/ready` and graceful shutdown

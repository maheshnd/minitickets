-- Adds bookings.idempotency_key (Feature 2, step F2b): the browser's random UUID for one booking intent.
-- Hand-edited: drizzle-kit wrote `ADD COLUMN ... NOT NULL`, which FAILS on a table that already has rows
-- (they would have no value). So:
--   1. add the column WITH a temporary default: Postgres fills every existing row with its own random
--      UUID (gen_random_uuid() runs once per row), so the old bookings get unique keys nobody knows;
--   2. drop the default again: from now on the API must always send a key (the schema has no default);
--   3. the unique constraint: one booking per (user_id, idempotency_key). PER USER on purpose: one
--      user's key can never collide with another user's. It also builds the index the replay lookup uses.
ALTER TABLE "bookings" ADD COLUMN "idempotency_key" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ALTER COLUMN "idempotency_key" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_user_id_idempotency_key_unique" UNIQUE("user_id","idempotency_key");

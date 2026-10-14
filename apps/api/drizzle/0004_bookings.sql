-- Adds the bookings table (Feature 2, step F2a): one row per successful "Book ticket", 1-4 tickets each.
-- The CHECKs make Postgres refuse a bad quantity or status, whoever writes the row.
-- The two foreign keys have no ON DELETE rule (NO ACTION): an event or user with bookings cannot be
-- deleted by accident. The table is new and empty, so the index costs nothing to build here.
-- Why the index (user_id, created_at): "My tickets" is WHERE user_id = $1 ORDER BY created_at DESC.
-- user_id first (equality: jump to this user's rows), created_at second (already sorted, no sort step).
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"status" text DEFAULT 'confirmed' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookings_quantity_1_to_4" CHECK ("bookings"."quantity" between 1 and 4),
	CONSTRAINT "bookings_status_valid" CHECK ("bookings"."status" in ('confirmed'))
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bookings_user_id_created_at_idx" ON "bookings" USING btree ("user_id","created_at");
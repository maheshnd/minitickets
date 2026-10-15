CREATE TABLE "outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"booking_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "outbox_booking_id_unique" UNIQUE("booking_id"),
	CONSTRAINT "outbox_attempts_not_negative" CHECK ("outbox"."attempts" >= 0)
);
--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "outbox_pending_idx" ON "outbox" USING btree ("available_at","id") WHERE "outbox"."sent_at" is null;
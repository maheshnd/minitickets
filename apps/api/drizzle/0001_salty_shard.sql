CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"venue" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"total_seats" integer NOT NULL,
	"seats_left" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_total_seats_positive" CHECK ("events"."total_seats" > 0),
	CONSTRAINT "events_seats_left_not_negative" CHECK ("events"."seats_left" >= 0),
	CONSTRAINT "events_seats_left_within_total" CHECK ("events"."seats_left" <= "events"."total_seats")
);

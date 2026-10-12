-- Adds users.role ("user" or "admin") for the admin-only events.create (Feature 1, step 6).
-- ADD COLUMN with a constant DEFAULT is instant in Postgres 11+: existing rows are not rewritten,
-- they simply read as 'user'. So every existing account becomes a normal user.
-- ADD CONSTRAINT ... CHECK reads every row once to make sure none breaks the rule. Fine while the
-- table is small; on a huge table you would add it NOT VALID first and VALIDATE it later.
ALTER TABLE "users" ADD COLUMN "role" text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_valid" CHECK ("users"."role" in ('user', 'admin'));

CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE INDEX "events_search_order_idx" ON "events" USING btree ("starts_at","id");--> statement-breakpoint
CREATE INDEX "events_search_trgm_idx" ON "events" USING gin (("title" || ' ' || "venue") gin_trgm_ops);
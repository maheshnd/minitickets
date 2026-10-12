-- Why this index: listUpcoming filters (starts_at > now), sorts (order by starts_at) and limits (50)
-- on the SAME column. A B-tree on starts_at is already sorted, so Postgres jumps to "now" and reads
-- the next 50 entries, instead of reading every row and sorting them.
-- Plain CREATE INDEX (not CONCURRENTLY): drizzle runs a migration inside a transaction, and
-- CONCURRENTLY cannot. That is fine while the table is small; see the explain-analyze handbook card.
CREATE INDEX "events_starts_at_idx" ON "events" USING btree ("starts_at");

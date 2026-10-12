import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { z } from "zod";
import { DatabaseEnvSchema } from "../config/database";
import { events } from "./schema/events";

// @concept: seed-data
// Fills the events table with sample rows for local development and for the e2e tests.
// Run it with: pnpm --filter @minitickets/api db:seed
// It is a dev tool: it is not in the production image and never runs on AWS.

// 1. Like migrate.ts, this script needs only the database settings.
const result = DatabaseEnvSchema.safeParse(process.env);
if (!result.success) {
  console.error("Invalid database settings:", z.flattenError(result.error).formErrors);
  process.exit(1);
}

// 2. Dates are "days from now", so there is always a mix of past and upcoming events.
//    Upcoming ones are at least 40 days out, so a seed run stays useful for a while.
const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();
const inDays = (days: number) => new Date(now + days * DAY);

// 3. Fixed ids (not random): the same event always has the same id, which is what makes
//    running the seed twice safe (see step 5). The e2e test looks for these titles.
const rows = [
  { id: "00000000-0000-4000-8000-000000000001", title: "Jazz Night (past)", venue: "Blue Note Hall", startsAt: inDays(-30), totalSeats: 200, seatsLeft: 12 },
  { id: "00000000-0000-4000-8000-000000000002", title: "Spring Food Fair (past)", venue: "City Park", startsAt: inDays(-90), totalSeats: 500, seatsLeft: 0 },
  { id: "00000000-0000-4000-8000-000000000003", title: "Retro Film Marathon (past)", venue: "Grand Cinema", startsAt: inDays(-5), totalSeats: 120, seatsLeft: 40 },
  { id: "00000000-0000-4000-8000-000000000004", title: "Indie Rock Showcase", venue: "The Foundry", startsAt: inDays(45), totalSeats: 300, seatsLeft: 180 },
  { id: "00000000-0000-4000-8000-000000000005", title: "Stand-up Comedy Night", venue: "Laugh Lounge", startsAt: inDays(60), totalSeats: 150, seatsLeft: 75 },
  { id: "00000000-0000-4000-8000-000000000006", title: "Symphony Under the Stars", venue: "Riverside Amphitheatre", startsAt: inDays(80), totalSeats: 1000, seatsLeft: 640 },
  { id: "00000000-0000-4000-8000-000000000007", title: "Startup Pitch Evening", venue: "Innovation Hub", startsAt: inDays(100), totalSeats: 250, seatsLeft: 250 },
  { id: "00000000-0000-4000-8000-000000000008", title: "Sold Out Gala Dinner", venue: "Palace Hotel Ballroom", startsAt: inDays(120), totalSeats: 100, seatsLeft: 0 },
  { id: "00000000-0000-4000-8000-000000000009", title: "Photography Workshop", venue: "Studio 9", startsAt: inDays(150), totalSeats: 30, seatsLeft: 8 },
  { id: "00000000-0000-4000-8000-00000000000a", title: "Classic Theatre: Hamlet", venue: "Royal Playhouse", startsAt: inDays(200), totalSeats: 400, seatsLeft: 310 },
  { id: "00000000-0000-4000-8000-00000000000b", title: "Open Air Cinema", venue: "Harbour Lawn", startsAt: inDays(260), totalSeats: 600, seatsLeft: 600 },
  { id: "00000000-0000-4000-8000-00000000000c", title: "New Year Fireworks Cruise", venue: "Pier 4", startsAt: inDays(400), totalSeats: 180, seatsLeft: 95 },
];

const pool = new Pool({ ...result.data, max: 1 });

try {
  // @concept: idempotency
  // 4. "on conflict do nothing": if a row with the same id is already there, skip it instead of failing.
  //    So running the seed twice (or on a database that already has data) never errors and never
  //    makes duplicates. It also never changes a row that exists, so edits you made by hand stay.
  const inserted = await drizzle(pool).insert(events).values(rows).onConflictDoNothing().returning({ id: events.id });
  console.log(`seed done: ${inserted.length} new events, ${rows.length - inserted.length} already there`);
} catch (err) {
  console.error("seed failed:", err);
  process.exitCode = 1;
} finally {
  // 5. Close the connection, otherwise Node would wait for it and never exit.
  await pool.end();
}

import { inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { z } from "zod";
import { DatabaseEnvSchema } from "../config/database";
import { bookings } from "./schema/bookings";
import { events } from "./schema/events";
import { SEED_EVENTS } from "./seed-events";

// @concept: seed-data
// Fills the events table with sample rows for local development and for the e2e tests.
// Run it with: pnpm --filter @minitickets/api db:seed            (adds the missing sample events)
//              pnpm --filter @minitickets/api db:seed --reset    (puts them back as they started)
// `pnpm dev` runs the first one, `pnpm stack:reset` the second.
// It is a dev tool: it is not in the production image and never runs on AWS.

// 1. Like migrate.ts, this script needs only the database settings.
const result = DatabaseEnvSchema.safeParse(process.env);
if (!result.success) {
  console.error("Invalid database settings:", z.flattenError(result.error).formErrors);
  process.exit(1);
}

// 2. --reset DELETES data, so it refuses any database that is not on this machine.
const reset = process.argv.includes("--reset");
const host = result.data.connectionString ? new URL(result.data.connectionString).hostname : result.data.host;
if (reset && !["localhost", "127.0.0.1", "::1", "[::1]"].includes(host ?? "")) {
  console.error(`--reset only runs against a database on this machine (DATABASE_URL host is "${host}").`);
  process.exit(1);
}

// 3. The sample events (seed-events.ts), with "days from now" turned into real dates.
const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();
const rows = SEED_EVENTS.map(({ daysFromNow, ...event }) => ({ ...event, startsAt: new Date(now + daysFromNow * DAY) }));
const ids = rows.map((row) => row.id);

const pool = new Pool({ ...result.data, max: 1 });
const db = drizzle(pool);

try {
  if (reset) {
    // 4. RESET, in one transaction (all or nothing):
    //    4a. Delete the bookings of the sample events. Their seats are about to be put back, so
    //        the old bookings would no longer add up (seats left + seats booked = all seats).
    //        Users, sessions and every other event stay as they are.
    //    4b. Write every sample event back to its starting values ("upsert": insert, or update the
    //        row with the same id). `excluded` = the row we tried to insert. Dates move forward
    //        too, so the upcoming ones are 40+ days away again.
    const deleted = await db.transaction(async (tx) => {
      const removed = await tx.delete(bookings).where(inArray(bookings.eventId, ids)).returning({ id: bookings.id });
      await tx
        .insert(events)
        .values(rows)
        .onConflictDoUpdate({
          target: events.id,
          set: {
            title: sql`excluded.title`,
            venue: sql`excluded.venue`,
            startsAt: sql`excluded.starts_at`,
            totalSeats: sql`excluded.total_seats`,
            seatsLeft: sql`excluded.seats_left`,
          },
        });
      return removed.length;
    });
    console.log(`seed reset: ${rows.length} events back to their starting values, ${deleted} of their bookings deleted`);
  } else {
    // @concept: idempotency
    // 5. "on conflict do nothing": if a row with the same id is already there, skip it instead of failing.
    //    So running the seed twice (or on a database that already has data) never errors and never
    //    makes duplicates. It also never changes a row that exists, so edits you made by hand stay.
    const inserted = await db.insert(events).values(rows).onConflictDoNothing().returning({ id: events.id });
    console.log(`seed done: ${inserted.length} new events, ${rows.length - inserted.length} already there`);
  }
} catch (err) {
  console.error("seed failed:", err);
  process.exitCode = 1;
} finally {
  // 6. Close the connection, otherwise Node would wait for it and never exit.
  await pool.end();
}

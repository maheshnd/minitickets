// Idempotency demo (step F2b). Run with: pnpm demo:idempotency [--url <api>] [--keep]
// Like booking-race-demo.ts, Node runs this TypeScript file directly (it strips the types).
//
// What it does:
//   1. Creates two test events with 10 seats each, straight in Postgres (DATABASE_URL from apps/api/.env).
//   2. Signs up ONE test user through the API and logs them in.
//   3. PART 1, the same booking 10 times at once: 10 identical "book 2 tickets" requests with the SAME
//      idempotency key, all started before any is awaited (like a client retrying hard, or a user
//      clicking like mad). Must give: 10 × 200, all with the SAME booking id, exactly 1 booking row,
//      and seats taken ONCE (10 -> 8).
//   4. PART 2, the same key with a different quantity (3 instead of 2): must be refused with 409
//      "This idempotency key was already used for a different booking", and change nothing.
//   5. PART 3, one NEW key sent for the two DIFFERENT events at the same moment, several rounds.
//      The row lock cannot queue these (each locks its own event), so here the UNIQUE
//      (user_id, idempotency_key) constraint decides: per round exactly one 200 and one 409, one
//      booking row, and only ONE event loses a seat (the loser's transaction rolled back).
//   6. PART 4, a retry after the first request took the LAST seats: event C has exactly 2 seats; book
//      2, then send the same request (same key) again. Must give 200 with the SAME booking, not 409
//      "Not enough seats left": that is why createBookingTx looks the key up BEFORE checking seats.
//   7. Checks every result against Postgres, the source of truth, then cleans up (--keep: leaves it all).
//
// Run it against YOUR OWN API instance (see AGENTS.md), e.g.:
//   pnpm demo:idempotency --url http://127.0.0.1:4101
// The API and this script must use the same database (both read DATABASE_URL).
//
// No extra library: requests use Node's built-in fetch; Postgres is reached with the `pg` package
// the API already depends on (loaded from apps/api, same trick as booking-race-demo.ts).

import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { parseArgs } from "node:util";

// 1. `pg` lives in apps/api's node_modules; createRequire resolves it from there (see
//    booking-race-demo.ts for the long explanation). Only the few pg calls we make are typed here.
type QueryResult<Row> = { rows: Row[] };
type PgPool = {
  query<Row = Record<string, unknown>>(text: string, values?: unknown[]): Promise<QueryResult<Row>>;
  end(): Promise<void>;
};
type PgModule = { Pool: new (config: { connectionString: string; max: number }) => PgPool };
const requireFromApi = createRequire(new URL("../apps/api/package.json", import.meta.url));
const { Pool } = requireFromApi("pg") as PgModule;

// 2. The command line. DATABASE_URL comes from apps/api/.env (the root script loads that file; a
//    value already set in the shell wins).
const { values } = parseArgs({
  options: {
    url: { type: "string", default: "http://localhost:4000" },
    keep: { type: "boolean", default: false },
  },
});
const API = values.url;
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set (copy apps/api/.env.example to apps/api/.env)");
  process.exit(1);
}

const SEATS = 10;
const COPIES = 10; // part 1: how many identical requests at once
const QUANTITY = 2; // part 1: tickets per booking
const ROUNDS = 5; // part 3: how many times the two-events race is run
const PASSWORD = "idempotency-demo-password";
const runId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const email = `idem-${runId}@example.com`;

const pool = new Pool({ connectionString: DATABASE_URL, max: 2 });

// 3. Call a tRPC mutation the way the browser does: POST /trpc/<path> with the input as JSON.
//    Returns the HTTP status, the answer's data (or error message) and the session cookie, if any.
async function trpcMutation(path: string, input: unknown, cookie?: string) {
  const response = await fetch(`${API}/trpc/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(input),
  });
  const body = (await response.json()) as { result?: { data: unknown }; error?: { message: string } };
  const sid = response.headers.getSetCookie().find((c) => c.startsWith("sid="))?.split(";")[0];
  return { status: response.status, data: body.result?.data as { id: string } | undefined, message: body.error?.message, sid };
}

// 4. A test event, straight in Postgres (no admin needed). Starts in 30 days, so it can be booked.
async function createEvent(name: string, seats = SEATS): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO events (title, venue, starts_at, total_seats, seats_left)
     VALUES ($1, 'Idempotency Demo Hall', now() + interval '30 days', $2, $2) RETURNING id`,
    [`Idempotency demo ${name} ${runId}`, seats],
  );
  return rows[0].id;
}

// 5. What Postgres says: seats left of each event, and this user's booking rows per key.
async function seatsLeft(eventId: string): Promise<number> {
  const { rows } = await pool.query<{ seats_left: number }>("SELECT seats_left FROM events WHERE id = $1", [eventId]);
  return rows[0].seats_left;
}
async function bookingsWithKey(userId: string, key: string) {
  const { rows } = await pool.query<{ id: string; event_id: string; quantity: number }>(
    "SELECT id, event_id, quantity FROM bookings WHERE user_id = $1 AND idempotency_key = $2",
    [userId, key],
  );
  return rows;
}

// One "expected vs actual" line; returns whether it held.
function check(label: string, actual: unknown, expected: unknown): boolean {
  const ok = actual === expected;
  console.log(`  ${ok ? "OK  " : "FAIL"} ${label}: ${String(actual)} (must be ${String(expected)})`);
  return ok;
}

async function main() {
  const eventA = await createEvent("A");
  const eventB = await createEvent("B");
  const eventC = await createEvent("C", 2);
  console.log(`Created events A ${eventA} and B ${eventB} (${SEATS} seats each), C ${eventC} (2 seats)`);

  const signup = await trpcMutation("auth.signup", { email, password: PASSWORD, confirmPassword: PASSWORD });
  if (signup.status !== 200) throw new Error(`signup failed: ${signup.status} ${signup.message}`);
  const userId = signup.data!.id;
  const login = await trpcMutation("auth.login", { email, password: PASSWORD });
  if (!login.sid) throw new Error(`login failed: ${login.status} ${login.message}`);
  const sid = login.sid;
  console.log(`Signed up and logged in ${email} through ${API}`);
  const results: boolean[] = [];

  try {
    // PART 1: the SAME booking (same key) 10 times at once.
    const key = randomUUID();
    const start = performance.now();
    const answers = await Promise.all(
      Array.from({ length: COPIES }, () => trpcMutation("bookings.create", { eventId: eventA, quantity: QUANTITY, idempotencyKey: key }, sid)),
    );
    const wallMs = performance.now() - start;
    const ids = new Set(answers.map((a) => a.data?.id ?? `error ${a.status} ${a.message}`));
    console.log(`\nPART 1: ${COPIES} identical requests (book ${QUANTITY}, key ${key.slice(0, 8)}…) at once: all answered in ${wallMs.toFixed(1)} ms`);
    console.log(`  statuses: ${answers.map((a) => a.status).join(" ")}`);
    console.log(`  booking id(s) in the answers: ${[...ids].join(", ")}`);
    const rows1 = await bookingsWithKey(userId, key);
    results.push(
      check("answers with 200", answers.filter((a) => a.status === 200).length, COPIES),
      check("different booking ids in the answers", ids.size, 1),
      check("booking rows for this key", rows1.length, 1),
      check("the answers' id is that row's id", [...ids][0], rows1[0]?.id),
      check("event A seats_left", await seatsLeft(eventA), SEATS - QUANTITY),
    );

    // PART 2: the same key, but a different quantity.
    const other = await trpcMutation("bookings.create", { eventId: eventA, quantity: 3, idempotencyKey: key }, sid);
    console.log(`\nPART 2: the same key with quantity 3 instead of ${QUANTITY}: ${other.status} "${other.message}"`);
    results.push(
      check("status", other.status, 409),
      check("message", other.message, "This idempotency key was already used for a different booking"),
      check("booking rows for this key", (await bookingsWithKey(userId, key)).length, 1),
      check("event A seats_left", await seatsLeft(eventA), SEATS - QUANTITY),
    );

    // PART 3: one new key for two DIFFERENT events at the same moment, ROUNDS times.
    console.log(`\nPART 3: one new key, 1 ticket of event A AND 1 of event B at the same moment, ${ROUNDS} rounds`);
    const seatsBefore = (await seatsLeft(eventA)) + (await seatsLeft(eventB));
    let goodRounds = 0;
    for (let round = 1; round <= ROUNDS; round++) {
      const raceKey = randomUUID();
      const [a, b] = await Promise.all([
        trpcMutation("bookings.create", { eventId: eventA, quantity: 1, idempotencyKey: raceKey }, sid),
        trpcMutation("bookings.create", { eventId: eventB, quantity: 1, idempotencyKey: raceKey }, sid),
      ]);
      const rows = await bookingsWithKey(userId, raceKey);
      const winner = rows[0]?.event_id === eventA ? "A" : rows[0]?.event_id === eventB ? "B" : "-";
      console.log(`  round ${round}: A -> ${a.status}, B -> ${b.status}; booking rows ${rows.length} (event ${winner})`);
      const statuses = [a.status, b.status].sort().join("+");
      if (statuses === "200+409" && rows.length === 1) goodRounds += 1;
    }
    const seatsAfter = (await seatsLeft(eventA)) + (await seatsLeft(eventB));
    results.push(
      check("rounds with exactly one 200 + one 409 + one row", goodRounds, ROUNDS),
      check("seats taken in part 3 (both events together)", seatsBefore - seatsAfter, ROUNDS),
    );

    // PART 4: the first request takes the LAST seats; then the same request comes again.
    const lastKey = randomUUID();
    const first = await trpcMutation("bookings.create", { eventId: eventC, quantity: 2, idempotencyKey: lastKey }, sid);
    const again = await trpcMutation("bookings.create", { eventId: eventC, quantity: 2, idempotencyKey: lastKey }, sid);
    console.log(`
PART 4: book the last 2 seats of event C, then the same request again: ${first.status}, then ${again.status} ${again.message ?? ""}`);
    results.push(
      check("first answer", first.status, 200),
      check("repeat answer (not 409 'Not enough seats left')", again.status, 200),
      check("same booking id", again.data?.id, first.data?.id),
      check("event C seats_left", await seatsLeft(eventC), 0),
    );

    const allOk = results.every(Boolean);
    console.log(allOk ? "\nOne key, one booking: repeats got the first answer, and seats were taken once." : "\nSomething is wrong: see FAIL above.");
    if (!allOk) process.exitCode = 1;
  } finally {
    // 7. Clean up: log out (deletes the session in Redis, through the API), then delete the rows.
    if (values.keep) {
      console.log(`\n--keep: left events ${eventA}, ${eventB}, ${eventC}, their bookings and the user ${email}`);
    } else {
      await trpcMutation("auth.logout", {}, sid);
      await pool.query("DELETE FROM bookings WHERE user_id = $1", [userId]);
      await pool.query("DELETE FROM events WHERE id = ANY($1)", [[eventA, eventB, eventC]]);
      await pool.query("DELETE FROM users WHERE id = $1", [userId]);
      console.log("\nCleaned up: session logged out; bookings, events and user deleted.");
    }
    await pool.end();
  }
}

await main();

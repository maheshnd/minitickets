// Booking race demo. Run with: pnpm demo:booking-race [--url <api>] [--unsafe] [--keep]
// Like stampede-demo.ts, Node runs this TypeScript file directly (it strips the types).
//
// What it does:
//   1. Creates a test event with 5 seats, straight in Postgres (DATABASE_URL from apps/api/.env).
//   2. Creates 20 test users through the API's signup.
//   3. SAFE mode (default): logs them all in, then fires 20 "book 1 ticket" requests at the API at
//      the SAME moment. The API books under a row lock (apps/api/src/queries/bookings.ts), so
//      exactly 5 must succeed and 15 must get 409 "Not enough seats left".
//      --unsafe: does the same read-then-write WITHOUT a lock, directly in SQL (not through the
//      API), to show overselling happen. See unsafeBooking below.
//   4. Prints the results and checks them against what must be true.
//   5. Cleans up: logs the users out, deletes the bookings, the event and the users (--keep: leaves
//      them, to look at them in psql).
//
// Run it against YOUR OWN API instance, e.g. one started with PORT=4101 (see AGENTS.md):
//   pnpm demo:booking-race --url http://127.0.0.1:4101
//   pnpm demo:booking-race --url http://127.0.0.1:4101 --unsafe
// The API and this script must use the same database (both read DATABASE_URL).
//
// No extra library: requests use Node's built-in fetch; Postgres is reached with the `pg` package
// the API already depends on (see step 1).

import { createRequire } from "node:module";
import { parseArgs } from "node:util";

// 1. `pg` is a dependency of apps/api, not of the repo root, and pnpm only links a package into the
//    node_modules of the package that depends on it. createRequire resolves `pg` FROM apps/api, as
//    if this file were there, so the demo needs no new dependency.
//    The types below describe only the few pg calls this file makes (its own types live in apps/api).
type QueryResult<Row> = { rows: Row[]; rowCount: number | null };
type PgClient = {
  query<Row = Record<string, unknown>>(text: string, values?: unknown[]): Promise<QueryResult<Row>>;
  release(): void;
};
type PgPool = PgClient & { connect(): Promise<PgClient>; end(): Promise<void> };
type PgModule = { Pool: new (config: { connectionString: string; max: number }) => PgPool };
const requireFromApi = createRequire(new URL("../apps/api/package.json", import.meta.url));
const { Pool } = requireFromApi("pg") as PgModule;

// 2. The command line. DATABASE_URL comes from apps/api/.env (the root script loads that file; a
//    value already set in the shell wins).
const { values } = parseArgs({
  options: {
    url: { type: "string", default: "http://localhost:4000" },
    unsafe: { type: "boolean", default: false },
    keep: { type: "boolean", default: false },
  },
});
const API = values.url;
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set (copy apps/api/.env.example to apps/api/.env)");
  process.exit(1);
}

const SEATS = 5;
const USERS = 20;
const PASSWORD = "race-demo-password";
const runId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

// 3. One connection per test user, so in --unsafe mode all 20 can really run at the same time
//    (the API's own pool is separate and has 10).
const pool = new Pool({ connectionString: DATABASE_URL, max: USERS + 2 });

// 4. Call a tRPC mutation the way the browser does: POST /trpc/<path> with the input as JSON.
//    Returns the HTTP status, the answer's data (or error message) and the session cookie, if any.
async function trpcMutation(path: string, input: unknown, cookie?: string) {
  const response = await fetch(`${API}/trpc/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(input),
  });
  const body = (await response.json()) as { result?: { data: unknown }; error?: { message: string } };
  const sid = response.headers.getSetCookie().find((c) => c.startsWith("sid="))?.split(";")[0];
  return { status: response.status, data: body.result?.data, message: body.error?.message, sid };
}

// 5. The test event, straight in Postgres (no admin needed). It starts in 30 days, so booking it is
//    allowed. Inserting it here does not touch the events cache; the bookings in SAFE mode do.
async function createEvent(): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO events (title, venue, starts_at, total_seats, seats_left)
     VALUES ($1, 'Race Demo Hall', now() + interval '30 days', $2, $2) RETURNING id`,
    [`Race demo ${runId}`, SEATS],
  );
  return rows[0].id;
}

// 6. The test users, through the API's signup (all at once; each one hashes a password).
async function createUsers(): Promise<{ id: string; email: string }[]> {
  return Promise.all(
    Array.from({ length: USERS }, async (_, i) => {
      const email = `race-${runId}-${i}@example.com`;
      const result = await trpcMutation("auth.signup", { email, password: PASSWORD, confirmPassword: PASSWORD });
      if (result.status !== 200) throw new Error(`signup failed for ${email}: ${result.status} ${result.message}`);
      return { id: (result.data as { id: string }).id, email };
    }),
  );
}

// 7. SAFE: 20 bookings through the API. Log everyone in first, so that only the bookings race.
//    Every request is STARTED before any is awaited, so they all reach the API together.
async function safeBookings(eventId: string, users: { email: string }[]) {
  const sessions = await Promise.all(
    users.map(async ({ email }) => {
      const login = await trpcMutation("auth.login", { email, password: PASSWORD });
      if (!login.sid) throw new Error(`login failed for ${email}: ${login.status} ${login.message}`);
      return login.sid;
    }),
  );

  const start = performance.now();
  const results = await Promise.all(
    sessions.map(async (sid) => {
      const sent = performance.now();
      const result = await trpcMutation("bookings.create", { eventId, quantity: 1 }, sid);
      return { status: result.status, message: result.message, ms: performance.now() - sent };
    }),
  );
  return { results, sessions, wallMs: performance.now() - start };
}

// 8. !!! UNSAFE, ON PURPOSE. THIS MODE EXISTS ONLY TO DEMONSTRATE THE BUG. NEVER BOOK LIKE THIS. !!!
//    The same read-then-write as the API, but WITHOUT the lock (no FOR UPDATE), and with the new
//    seat count computed HERE, in the app, from the number we read:
//      BEGIN; SELECT seats_left (all 20 can read "5" at once) -> enough? ->
//      UPDATE ... SET seats_left = <what we read - 1>; INSERT booking; COMMIT
//    The UPDATEs do wait for each other (Postgres locks a row while updating it), but each one
//    then writes ITS OWN number ("4"), overwriting the others: the "lost update". Every booking
//    succeeds, so 20 bookings share 5 seats, and seats_left still says 4.
//    (The CHECK seats_left >= 0 cannot help here: 4 is a valid number. It does catch the relative
//    form `seats_left = seats_left - 1`, which is why the API uses that form too.)
async function unsafeBooking(client: PgClient, eventId: string, userId: string) {
  await client.query("BEGIN");
  try {
    const { rows } = await client.query<{ seats_left: number }>("SELECT seats_left FROM events WHERE id = $1", [eventId]);
    const seatsLeft = rows[0].seats_left;
    if (seatsLeft < 1) {
      await client.query("ROLLBACK");
      return "refused";
    }
    await client.query("UPDATE events SET seats_left = $2 WHERE id = $1", [eventId, seatsLeft - 1]);
    await client.query("INSERT INTO bookings (event_id, user_id, quantity) VALUES ($1, $2, 1)", [eventId, userId]);
    await client.query("COMMIT");
    return "booked";
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

async function unsafeBookings(eventId: string, users: { id: string }[]) {
  // Open all 20 connections first, so connecting does not spread the race out over time.
  const clients = await Promise.all(users.map(() => pool.connect()));
  try {
    const start = performance.now();
    const outcomes = await Promise.all(clients.map((client, i) => unsafeBooking(client, eventId, users[i].id)));
    return { outcomes, wallMs: performance.now() - start };
  } finally {
    for (const client of clients) client.release();
  }
}

// 9. What the database says afterwards: the source of truth, whatever the requests answered.
async function finalState(eventId: string) {
  const { rows } = await pool.query<{ seats_left: number; bookings: string; tickets: string | null }>(
    `SELECT e.seats_left,
            (SELECT count(*) FROM bookings b WHERE b.event_id = e.id) AS bookings,
            (SELECT sum(quantity) FROM bookings b WHERE b.event_id = e.id) AS tickets
     FROM events e WHERE e.id = $1`,
    [eventId],
  );
  return { seatsLeft: rows[0].seats_left, bookings: Number(rows[0].bookings), tickets: Number(rows[0].tickets ?? 0) };
}

// 10. Remove what the demo made, so /events and the users table do not fill up with test rows.
//     Logging out deletes the sessions in Redis (through the API, the only code that knows them).
async function cleanUp(eventId: string, sessions: string[]) {
  await Promise.all(sessions.map((sid) => trpcMutation("auth.logout", {}, sid)));
  await pool.query("DELETE FROM bookings WHERE event_id = $1", [eventId]);
  await pool.query("DELETE FROM events WHERE id = $1", [eventId]);
  await pool.query("DELETE FROM users WHERE email LIKE $1", [`race-${runId}-%@example.com`]);
}

// One "expected vs actual" line; returns whether it held.
function check(label: string, actual: number, expected: number): boolean {
  const ok = actual === expected;
  console.log(`  ${ok ? "OK  " : "FAIL"} ${label}: ${actual} (must be ${expected})`);
  return ok;
}

async function main() {
  const mode = values.unsafe ? "UNSAFE (no lock, direct SQL: demonstrates the bug)" : "SAFE (through the API, row lock)";
  console.log(`Mode: ${mode}`);
  const eventId = await createEvent();
  console.log(`Created event ${eventId} with ${SEATS} seats`);
  const users = await createUsers();
  console.log(`Signed up ${users.length} users through ${API}`);
  let sessions: string[] = [];

  try {
    if (!values.unsafe) {
      const run = await safeBookings(eventId, users);
      sessions = run.sessions;
      const count = (status: number) => run.results.filter((r) => r.status === status).length;
      const ms = run.results.map((r) => r.ms).sort((a, b) => a - b);
      const others = run.results.filter((r) => r.status !== 200 && r.status !== 409);
      console.log(`\nFired ${USERS} booking requests for 1 ticket at once: all answered in ${run.wallMs.toFixed(1)} ms`);
      console.log(`  timings: fastest ${ms[0].toFixed(1)} ms, slowest ${ms[ms.length - 1].toFixed(1)} ms`);
      if (others.length > 0) console.log(`  other answers: ${others.map((r) => `${r.status} ${r.message}`).join("; ")}`);
      const messages = [...new Set(run.results.filter((r) => r.status === 409).map((r) => r.message))];
      console.log(`  409 message(s): ${messages.join(" | ") || "-"}`);

      const state = await finalState(eventId);
      console.log("\nResults:");
      const allOk = [
        check("succeeded (200)", count(200), SEATS),
        check("refused (409)", count(409), USERS - SEATS),
        check("final seats_left", state.seatsLeft, 0),
        check("bookings rows", state.bookings, SEATS),
      ].every(Boolean);
      console.log(allOk ? "\nNo overselling: the row lock made the bookings wait their turn." : "\nSomething is wrong: see FAIL above.");
      if (!allOk) process.exitCode = 1;
    } else {
      const run = await unsafeBookings(eventId, users);
      const booked = run.outcomes.filter((o) => o === "booked").length;
      console.log(`\nRan ${USERS} unlocked read-then-write transactions at once: done in ${run.wallMs.toFixed(1)} ms`);
      const state = await finalState(eventId);
      console.log("\nResults (what a correct system would show in brackets):");
      console.log(`  "booked":          ${booked} (${SEATS})`);
      console.log(`  "refused":         ${USERS - booked} (${USERS - SEATS})`);
      console.log(`  final seats_left:  ${state.seatsLeft} (0)`);
      console.log(`  bookings rows:     ${state.bookings} (${SEATS})`);
      const oversold = state.tickets - SEATS;
      console.log(
        oversold > 0
          ? `\nOVERSOLD: ${state.tickets} tickets for ${SEATS} seats (${oversold} too many), and seats_left says ${state.seatsLeft}. That is the lost-update race.`
          : "\nNo overselling this time (the race is timing-dependent); run it again.",
      );
    }
  } finally {
    if (values.keep) {
      console.log(`\n--keep: left the event ${eventId}, its bookings and the users race-${runId}-*@example.com`);
    } else {
      await cleanUp(eventId, sessions);
      const loggedOut = sessions.length > 0 ? `${sessions.length} sessions logged out; ` : "";
      console.log(`\nCleaned up: ${loggedOut}bookings, event and users deleted.`);
    }
    await pool.end();
  }
}

await main();

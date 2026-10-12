// Cache stampede demo. Run with: pnpm demo:stampede [--url <api>]... [-n <count>]
// Like check-concepts.ts, Node runs this TypeScript file directly (it strips the types).
//
// What it does:
//   1. Bumps the events list's cache generation in Redis (INCR), so the next request is a MISS.
//   2. Fires N events.list requests at the same moment, at each --url (default: 100 at :4000).
//   3. Prints the status codes and timings.
// Then count the "db query: events.listUpcoming" lines in the API's log (start the API with
// LOG_LEVEL=debug). Without stampede protection, many of the N requests each query Postgres.
//
// Examples:
//   pnpm demo:stampede --url http://127.0.0.1:4101
//   pnpm demo:stampede --url http://127.0.0.1:4101 --url http://127.0.0.1:4102 -n 50   (50 at EACH)
//
// No extra library: requests use Node's built-in fetch, Redis is spoken to over a plain TCP socket.

import net from "node:net";
import { parseArgs } from "node:util";

// 1. Must be the same as UPCOMING_GEN_KEY in apps/api/src/queries/events-cache.ts.
//    (We do not import it: importing API code would also load its env checks and Redis client.)
//    Bumping it is exactly what creating an event does: every reader moves to a new, empty key.
const GEN_KEY = "events:upcoming:gen";

// 2. Read the command line. REDIS_URL comes from apps/api/.env (the root script loads that file),
//    so the demo bumps the key in the same Redis the API uses.
const { values } = parseArgs({
  options: {
    url: { type: "string", multiple: true, default: ["http://localhost:4000"] },
    n: { type: "string", short: "n", default: "100" },
    redis: { type: "string", default: process.env.REDIS_URL ?? "redis://localhost:6379" },
  },
});
const urls = values.url;
const perUrl = Number(values.n);
if (!Number.isInteger(perUrl) || perUrl < 1) {
  console.error(`-n must be a whole number above 0, got "${values.n}"`);
  process.exit(1);
}

// 3. Bump the generation. Redis's protocol (RESP) is plain text: a command is sent as an array of
//    strings ("*2" = 2 parts, "$4" = the next part is 4 bytes long). The reply to INCR is ":<n>",
//    the new number. "-" at the start means an error.
function redisIncr(redisUrl: string, key: string): Promise<number> {
  const { protocol, hostname, port } = new URL(redisUrl);
  if (protocol !== "redis:") throw new Error(`only plain redis:// URLs are supported here, got ${protocol}`);
  const command = `*2\r\n$4\r\nINCR\r\n$${Buffer.byteLength(key)}\r\n${key}\r\n`;

  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: hostname, port: Number(port || 6379) }, () => socket.write(command));
    socket.once("data", (reply) => {
      socket.end();
      const text = reply.toString();
      if (text.startsWith(":")) resolve(Number(text.slice(1)));
      else reject(new Error(`Redis answered: ${text.trim()}`));
    });
    socket.once("error", reject);
  });
}

// 4. One request: its status code and how long it took (including reading the body).
//    A network error (API not running) counts as status 0 instead of stopping the whole demo.
async function timedRequest(baseUrl: string): Promise<{ status: number; ms: number }> {
  const start = performance.now();
  try {
    const response = await fetch(`${baseUrl}/trpc/events.list`);
    await response.text();
    return { status: response.status, ms: performance.now() - start };
  } catch {
    return { status: 0, ms: performance.now() - start };
  }
}

// 5. The value below which `p` percent of the (sorted) timings fall.
function percentile(sortedMs: number[], p: number): number {
  const index = Math.min(sortedMs.length - 1, Math.ceil((p / 100) * sortedMs.length) - 1);
  return sortedMs[Math.max(0, index)];
}

async function main() {
  const gen = await redisIncr(values.redis, GEN_KEY);
  console.log(`Bumped ${GEN_KEY} to ${gen}: the cached list is now a miss`);
  console.log(`Firing ${perUrl} requests at each of: ${urls.join(", ")} (all at once)\n`);

  // 6. Start EVERY request before awaiting any, so they all arrive while the cache is empty.
  const wallStart = performance.now();
  const results = await Promise.all(
    urls.map((url) => Promise.all(Array.from({ length: perUrl }, () => timedRequest(url)))),
  );
  const wallMs = performance.now() - wallStart;

  // 7. Report per URL: how many of each status code, and the timings.
  results.forEach((list, i) => {
    const statuses = new Map<number, number>();
    for (const { status } of list) statuses.set(status, (statuses.get(status) ?? 0) + 1);
    const ms = list.map((r) => r.ms).sort((a, b) => a - b);
    const fmt = (n: number) => `${n.toFixed(1)} ms`;
    console.log(urls[i]);
    console.log(`  status codes: ${[...statuses].map(([code, count]) => `${code} x ${count}`).join(", ")}`);
    console.log(
      `  timings: min ${fmt(ms[0])}, median ${fmt(percentile(ms, 50))}, p95 ${fmt(percentile(ms, 95))}, max ${fmt(ms[ms.length - 1])}`,
    );
  });
  console.log(`\nAll ${perUrl * urls.length} requests done in ${wallMs.toFixed(1)} ms.`);
  console.log('Now count the "db query: events.listUpcoming" lines in the API log (LOG_LEVEL=debug).');
}

await main();

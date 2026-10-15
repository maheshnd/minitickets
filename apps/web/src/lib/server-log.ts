// @concept: structured-logging
// The web SERVER's own log lines as JSON (series 2, P2), in the same shape as the api (pino) and the
// worker (apps/worker/src/log.ts): {"level":50,"time":…,"msg":"…", …fields}. On AWS they land in
// /minitickets/dev/web, where CloudWatch Logs Insights reads every field by itself; the same
// `filter level >= 50` query then finds errors in all three apps.
// Only for server code (pages, route handlers, server helpers). Next.js's own lines ("✓ Ready", …)
// stay text: they are not ours.

// 1. pino's level numbers, like the api and the worker.
const LEVELS = { info: 30, warn: 40, error: 50 } as const;

// 2. One JSON object per line. process.stdout.write, not console.*, so nothing is added in front.
export function serverLog(level: keyof typeof LEVELS, msg: string, fields: Record<string, unknown> = {}): void {
  process.stdout.write(`${JSON.stringify({ level: LEVELS[level], time: Date.now(), ...fields, msg })}\n`);
}

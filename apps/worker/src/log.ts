// @concept: structured-logging
// STRUCTURED JSON LOGS for the worker (series 2, P2): one JSON object per line, never free text.
//
//   before: [worker] message 1a2b (try 1): email sent [booking.confirmed:7c9d]
//   now:    {"level":30,"time":1760550000000,"correlationId":"7f3c…","sqsMessageId":"1a2b","tries":"1","jobKey":"booking.confirmed:7c9d","msg":"email sent"}
//
// WHY: CloudWatch Logs Insights reads every JSON field of a line by itself, so a question like
// "every line of correlation id 7f3c…, in the api AND the worker" or "all errors in the last hour"
// is one query (docs/20-deploy-day.md 3.12), not a regex over text.
// The SAME shape as the api's lines (Fastify uses pino): "level" as pino's numbers (30 info,
// 40 warn, 50 error), "time" in milliseconds, "msg" for the text. So one query works on both.
//
// WHY not pino here too: no new library for ~30 lines; the worker writes few lines.
// WHY process.stdout.write and not console.log: on Lambda, console.log prefixes each line with a
// timestamp, the request id and the level ("2026-… 1a2b… INFO {…}"), and then the line is no longer
// JSON (the function's log format is "Text", infra/src/jobs/worker-lambda.ts). Raw stdout lines
// arrive in CloudWatch exactly as written. Lambda's own START / END / REPORT lines stay text; Logs
// Insights reads those by itself (@duration, @maxMemoryUsed).

export type Fields = Record<string, unknown>;

export interface Log {
  info(msg: string, fields?: Fields): void;
  warn(msg: string, fields?: Fields): void;
  error(msg: string, fields?: Fields): void;
  // A logger that adds `fields` to every line it writes (like pino's child): e.g. one per message,
  // so each of its lines carries that message's correlationId without repeating it.
  child(fields: Fields): Log;
}

// 1. pino's level numbers, so `filter level >= 50` finds errors in the api and the worker alike.
const LEVELS = { info: 30, warn: 40, error: 50 } as const;

// 2. Where a line goes. Tests pass their own function to collect the lines.
type Write = (line: string) => void;
const toStdout: Write = (line) => {
  process.stdout.write(line);
};

// 3. Build a logger. `bindings` are on every line (e.g. awsRequestId for one Lambda call).
//    Fields that are undefined are left out (JSON.stringify drops them), so an old message without
//    a correlationId simply has no such field.
export function createLog(bindings: Fields = {}, write: Write = toStdout): Log {
  const line = (level: keyof typeof LEVELS, msg: string, fields: Fields = {}) => {
    write(`${JSON.stringify({ level: LEVELS[level], time: Date.now(), ...bindings, ...fields, msg })}\n`);
  };
  return {
    info: (msg, fields) => line("info", msg, fields),
    warn: (msg, fields) => line("warn", msg, fields),
    error: (msg, fields) => line("error", msg, fields),
    child: (fields) => createLog({ ...bindings, ...fields }, write),
  };
}

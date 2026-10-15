import { CorrelationId } from "@minitickets/shared";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";

// @concept: correlation-ids
// One CORRELATION ID per request (series 2, P2). Fastify calls it the "request id" (request.id);
// app.ts makes Fastify write it on every log line of the request as "correlationId", and the
// bookings service copies it into the queue message, so the worker's lines carry it too:
//
//   browser ──▶ api  { correlationId: 7f3c…, msg: "incoming request" }
//                    { correlationId: 7f3c…, msg: "published booking.confirmed …" }
//                    message { …, correlationId: 7f3c… } ──▶ SQS ──▶ worker Lambda
//                                                            { correlationId: 7f3c…, msg: "email sent" }
//
// One search for 7f3c… (CloudWatch Logs Insights, docs/20-deploy-day.md 3.12) shows the whole booking.

// 1. The header a caller may send its own id in, and in which every answer carries ours.
//    WHY answer with it: a user (or support) can quote it from the browser's network tab, and we
//    find every line of that request at once.
export const CORRELATION_HEADER = "x-correlation-id";

// 2. The id for a new request: the caller's, if it sent a valid one, else a new random UUID.
//    WHY accept the caller's: a service calling us (or a test) can follow its own id through.
//    WHY only a UUID: anything a caller sends ends up in our logs. A strict format means nobody can
//      write text (fake log lines, very long values) there. A wrong value is not an error: the
//      request just gets a new id.
//    WHY a UUID and not Fastify's default (req-1, req-2, …): those restart in every process, so two
//      api tasks both have a "req-1". A random UUID is unique across tasks and services.
export function correlationIdFor(incoming: string | string[] | undefined): string {
  const parsed = CorrelationId.safeParse(incoming);
  return parsed.success ? parsed.data : randomUUID();
}

// 3. Send the id back on EVERY answer, also errors and 404s (onRequest runs before any route).
export function addCorrelationIdHeader(app: FastifyInstance): void {
  app.addHook("onRequest", async (request, reply) => {
    reply.header(CORRELATION_HEADER, request.id);
  });
}

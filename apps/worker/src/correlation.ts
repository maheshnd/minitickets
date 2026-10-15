import { CorrelationId } from "@minitickets/shared";

// @concept: correlation-ids
// The correlation id of one queue message (series 2, P2): the id of the api request that booked
// (apps/api/src/http/correlation-id.ts), carried in the message body. The worker writes it on each
// of its log lines for that message, so the api's lines and the worker's lines of ONE booking are
// found with one search.
//
// Read BEFORE the handler validates the message, on purpose: even a message that turns out to be
// invalid (and fails, and ends in the DLQ) still has its id on the failure lines, so we can find the
// request that sent it. undefined when there is none: bad JSON, a message sent before P2, or a value
// that is not a UUID (never copy unchecked text into our logs).
export function correlationIdOf(body: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed !== "object" || parsed === null || !("correlationId" in parsed)) return undefined;
    const id = CorrelationId.safeParse(parsed.correlationId);
    return id.success ? id.data : undefined;
  } catch {
    return undefined;
  }
}

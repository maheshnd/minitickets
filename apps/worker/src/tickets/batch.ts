import type { SQSEvent, SQSBatchResponse } from "aws-lambda";
import { correlationIdOf } from "../correlation";
import { handleTickets, type TicketDeps } from "../handlers/tickets";
import type { Log } from "../log";

export async function handleTicketBatch(event: SQSEvent, deps: TicketDeps, log: Log): Promise<SQSBatchResponse> {
  // 1. A failed booking must not retry its successful neighbours. Report only failed ids;
  //    never print bodies, tokens, secret values or raw validation errors.
  const batchItemFailures: SQSBatchResponse["batchItemFailures"] = [];
  for (const record of event.Records) {
    const messageLog = log.child({ correlationId: correlationIdOf(record.body), sqsMessageId: record.messageId });
    try {
      const counts = await handleTickets(JSON.parse(record.body), deps);
      messageLog.info("tickets processed", counts);
    } catch {
      messageLog.error("ticket generation failed; message will retry");
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures };
}

import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import type { BookingConfirmedMessage } from "@minitickets/shared";
import { env } from "../config/env";

// Queues: the only code that talks to a message queue (like queries/ for databases). Only services
// call it. No business logic here: it sends what it is given.

// 1. One client for the whole process. SQS_ENDPOINT is set locally (ElasticMQ) and unset on AWS.
//    Short timeouts bound how long the outbox relay holds database locks on an unreachable queue.
//    maxAttempts 1: no hidden retries; the relay persists the next attempt time.
//    On AWS the SDK finds its credentials from the task role by itself; locally they are the
//    dummy keys from .env.
const sqs = new SQSClient({
  region: env.AWS_REGION,
  endpoint: env.SQS_ENDPOINT,
  maxAttempts: 1,
  // 1b. In this SDK, requestTimeout alone only warns. Throw too, or a silent queue could keep
  //     the relay transaction (and graceful shutdown) waiting indefinitely with its rows locked.
  requestHandler: { connectionTimeout: 1000, requestTimeout: 2000, throwOnRequestTimeout: true },
});

// 2. Is publishing turned on? (JOBS_QUEUE_URL is optional, see config/env.ts.)
export const jobsEnabled = env.JOBS_QUEUE_URL !== undefined;

// 3. Put a "booking confirmed" message on the jobs queue. Resolves when the queue has ACCEPTED it
//    (not when the email is sent: that is the worker's job, later). Rejects if the queue is
//    unreachable or refuses; the relay retries later. Refuse an unconfigured queue too: silently
//    succeeding here would let a caller mark an unsent outbox row as sent.
export async function publishBookingConfirmed(message: BookingConfirmedMessage): Promise<void> {
  if (!env.JOBS_QUEUE_URL) throw new Error("jobs queue is not configured");
  await sqs.send(new SendMessageCommand({ QueueUrl: env.JOBS_QUEUE_URL, MessageBody: JSON.stringify(message) }));
}

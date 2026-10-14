import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import type { BookingConfirmedMessage } from "@minitickets/shared";
import { env } from "../config/env";

// Queues: the only code that talks to a message queue (like queries/ for databases). Only services
// call it. No business logic here: it sends what it is given.

// 1. One client for the whole process. SQS_ENDPOINT is set locally (ElasticMQ) and unset on AWS.
//    The short timeouts matter: publishing must never make a booking slow. If the queue is
//    unreachable we want to give up after ~2 s, not wait for the SDK's long defaults.
//    maxAttempts 1: no hidden retries; the service decides what a failure means (it logs it).
//    On AWS the SDK finds its credentials from the task role by itself; locally they are the
//    dummy keys from .env.
const sqs = new SQSClient({
  region: env.AWS_REGION,
  endpoint: env.SQS_ENDPOINT,
  maxAttempts: 1,
  requestHandler: { connectionTimeout: 1000, requestTimeout: 2000 },
});

// 2. Is publishing turned on? (JOBS_QUEUE_URL is optional, see config/env.ts.)
export const jobsEnabled = env.JOBS_QUEUE_URL !== undefined;

// 3. Put a "booking confirmed" message on the jobs queue. Resolves when the queue has ACCEPTED it
//    (not when the email is sent: that is the worker's job, later). Rejects if the queue is
//    unreachable or refuses; the caller decides what that means. Does nothing when publishing is off.
export async function publishBookingConfirmed(message: BookingConfirmedMessage): Promise<void> {
  if (!env.JOBS_QUEUE_URL) return;
  await sqs.send(new SendMessageCommand({ QueueUrl: env.JOBS_QUEUE_URL, MessageBody: JSON.stringify(message) }));
}

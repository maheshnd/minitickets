import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import type { BookingConfirmedMessage } from "@minitickets/shared";
import { env } from "../config/env";

// 1. Publish once to SNS; independent SQS subscriptions deliver email and tickets.
//    No hidden retries: the outbox owns backoff, with bounded transaction time.
const sns = new SNSClient({
  region: env.AWS_REGION,
  endpoint: env.SNS_ENDPOINT,
  maxAttempts: 1,
  requestHandler: { connectionTimeout: 1000, requestTimeout: 2000, throwOnRequestTimeout: true },
});
export const jobsEnabled = env.BOOKING_EVENTS_TOPIC_ARN !== undefined;

// 2. SNS acceptance is independent of consumer completion. On failure the outbox row
//    stays pending; raw SQS delivery preserves this exact JSON shape for each consumer.
export async function publishBookingConfirmed(message: BookingConfirmedMessage): Promise<void> {
  if (!env.BOOKING_EVENTS_TOPIC_ARN) throw new Error("booking events topic is not configured");
  await sns.send(new PublishCommand({ TopicArn: env.BOOKING_EVENTS_TOPIC_ARN, Message: JSON.stringify(message) }));
}

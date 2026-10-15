import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import { tagsFor } from "../tags";
import type { JobQueuesOutputs } from "./queues";

// 1. SNS copies an event to BOTH queues; SQS buffers each consumer independently. Always on,
//    request-billed with no idle fee. Retain the existing email queue and its waiting messages.
export function createBookingEvents(email: JobQueuesOutputs, tickets: JobQueuesOutputs) {
  const name = "minitickets-dev-booking-events";
  const topic = new aws.sns.Topic(name, { name, tags: tagsFor(name) });
  const subscriptions: aws.sns.TopicSubscription[] = [];
  for (const [consumer, queue] of [["email", email], ["tickets", tickets]] as const) {
    // 2. WHO: SNS only, from THIS topic in THIS account. WHAT: SendMessage on ONE queue.
    //    ATTACHED: the queue resource policy, not either Lambda's execution role.
    const policy = new aws.sqs.QueuePolicy(`${name}-${consumer}`, {
      queueUrl: queue.queueUrl,
      policy: pulumi.jsonStringify({ Version: "2012-10-17", Statement: [{ Effect: "Allow",
        Principal: { Service: "sns.amazonaws.com" }, Action: "sqs:SendMessage", Resource: queue.queueArn,
        Condition: { ArnEquals: { "aws:SourceArn": topic.arn },
          StringEquals: { "aws:SourceAccount": aws.getCallerIdentityOutput().accountId } },
      }] }),
    });
    // 3. Raw delivery keeps the existing versioned JSON contract. Each queue already has its
    //    own consumer DLQ. Subscribe only after its queue policy allows SNS to deliver.
    subscriptions.push(new aws.sns.TopicSubscription(`${name}-${consumer}`, {
      topic: topic.arn, protocol: "sqs", endpoint: queue.queueArn, rawMessageDelivery: true,
    }, { dependsOn: [policy] }));
  }
  // 4. Do not start a publisher before BOTH routes exist: SNS accepts events even with no
  //    subscriptions, which would let the relay mark an undelivered outbox row as sent.
  return { topicArn: pulumi.all([topic.arn, ...subscriptions.map(sub => sub.id)]).apply(([arn]) => arn) };
}

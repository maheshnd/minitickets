// LAYER: observability / alert topic (series 2, P2)
// NEEDS (inputs):   alertEmail <- from Pulumi config (the same address the budget emails)
// CREATES:          SNS topic minitickets-dev-alerts, its topic policy (only CloudWatch alarms of
//                   this account may publish), and an email subscription (you confirm it by hand)
// GIVES (outputs):  topicArn -> observability/alarms (where each alarm sends ALARM and OK)
//
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { tagsFor } from "../tags";
import { ALARM_PREFIX } from "./alarm-specs";

// @concept: alerting
// SNS (Simple Notification Service) in simple words: a loudspeaker. Something publishes ONE message
// to the topic; SNS delivers a copy to every subscriber (here: one email address; later P4 uses SNS
// to send one booking event to several queues).
//
//   CloudWatch alarm ── Publish ──▶ SNS topic minitickets-dev-alerts ── email ──▶ you
//
// Always on: a topic and its email deliveries cost nothing at our volume (the first 1,000 emails a
// month are free), and the DLQ alarm (always on too) needs somewhere to send.

const prefix = "minitickets-dev";

export interface AlertTopicInputs {
  alertEmail: pulumi.Input<string>;
}

export interface AlertTopicOutputs {
  topicArn: pulumi.Output<string>;
}

export function createAlertTopic(inputs: AlertTopicInputs): AlertTopicOutputs {
  // 1. The topic.
  //    NO encryption on purpose: CloudWatch alarms can publish to an encrypted topic only if the
  //    key's policy lets the CloudWatch service use it, and the free AWS-managed key (aws/sns) has
  //    a fixed policy that does not. A customer-managed KMS key would work ($1/month + a key policy).
  //    The messages say only "alarm X is in ALARM": no personal data, nothing secret.
  // DEPENDS ON: nothing.
  const topic = new aws.sns.Topic(`${prefix}-alerts`, {
    name: `${prefix}-alerts`,
    displayName: "MiniTickets dev alerts",
    tags: tagsFor(`${prefix}-alerts`),
  });

  // 2. The topic policy (a RESOURCE policy: it sits on the topic and says who may use it).
  //    WHO: the CloudWatch service (cloudwatch.amazonaws.com), and only for alarms of THIS account
  //      whose names start with minitickets-dev- (aws:SourceArn). WHY the conditions: without them
  //      any account's CloudWatch could be tricked into publishing here ("confused deputy").
  //    WHAT: sns:Publish only.
  //    ATTACHED TO: this topic.
  //    It REPLACES the default topic policy (which lets every principal of the account use the
  //    topic). Our own access (you, the deploy role) still works through IAM: inside one account an
  //    identity policy alone is enough.
  // DEPENDS ON: topic.
  const accountId = aws.getCallerIdentityOutput().accountId;
  const region = aws.getRegionOutput().region;
  new aws.sns.TopicPolicy(`${prefix}-alerts-policy`, {
    arn: topic.arn,
    policy: pulumi.jsonStringify({
      Version: "2012-10-17",
      Statement: [
        {
          Sid: "OurCloudWatchAlarmsMayPublish",
          Effect: "Allow",
          Principal: { Service: "cloudwatch.amazonaws.com" },
          Action: "sns:Publish",
          Resource: topic.arn,
          Condition: {
            ArnLike: { "aws:SourceArn": pulumi.interpolate`arn:aws:cloudwatch:${region}:${accountId}:alarm:${ALARM_PREFIX}*` },
            StringEquals: { "aws:SourceAccount": accountId },
          },
        },
      ],
    }),
  });

  // 3. The email subscription. AWS sends "AWS Notification - Subscription Confirmation" to the
  //    address; NOTHING is delivered until you click "Confirm subscription" in it (so nobody can
  //    sign a stranger up for mail). Until then the console shows "Pending confirmation", and an
  //    unconfirmed subscription expires after 3 days. Lost the email? SNS console -> Subscriptions
  //    -> select it -> "Request confirmation" (docs/20-deploy-day.md 3.12).
  // DEPENDS ON: topic.
  new aws.sns.TopicSubscription(`${prefix}-alerts-email`, {
    topic: topic.arn,
    protocol: "email",
    endpoint: inputs.alertEmail,
  });

  return { topicArn: topic.arn };
}

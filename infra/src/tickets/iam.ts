import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import { tagsFor } from "../tags";
import { prefix } from "../stack";

export function createTicketRole(inputs: {
  queueArn: pulumi.Input<string>; tableArn: pulumi.Input<string>; bucketArn: pulumi.Input<string>;
  secretArn: pulumi.Input<string>; logGroupArn: pulumi.Input<string>;
}) {
  // 1. WHO: Lambda. WHAT: consume one queue, reserve/complete one table, write ONLY tickets/,
  //    read one signing secret and write one log group. ATTACHED: minitickets-dev-tickets.
  const role = new aws.iam.Role(`${prefix}-tickets-role`, {
    name: `${prefix}-tickets-role`, tags: tagsFor(`${prefix}-tickets-role`),
    assumeRolePolicy: JSON.stringify({ Version: "2012-10-17", Statement: [{ Effect: "Allow",
      Principal: { Service: "lambda.amazonaws.com" }, Action: "sts:AssumeRole" }] }),
  });
  const policy = new aws.iam.RolePolicy(`${prefix}-tickets-policy`, {
    name: "tickets", role: role.id,
    policy: pulumi.jsonStringify({ Version: "2012-10-17", Statement: [
      { Effect: "Allow", Action: ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"], Resource: inputs.queueArn },
      { Effect: "Allow", Action: ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem"], Resource: inputs.tableArn },
      { Effect: "Allow", Action: "s3:PutObject", Resource: pulumi.interpolate`${inputs.bucketArn}/tickets/*` },
      { Effect: "Allow", Action: "secretsmanager:GetSecretValue", Resource: inputs.secretArn },
      { Effect: "Allow", Action: ["logs:CreateLogStream", "logs:PutLogEvents"], Resource: pulumi.interpolate`${inputs.logGroupArn}:*` },
    ] }),
  });
  // 2. The trigger validates role permissions immediately, so wait for the attached policy.
  return { roleArn: pulumi.all([role.arn, policy.id]).apply(([arn]) => arn) };
}

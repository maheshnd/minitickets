import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import { tagsFor } from "../tags";

export function createTicketLambda(inputs: {
  image: pulumi.Input<string>; roleArn: pulumi.Input<string>; logGroupName: pulumi.Input<string>;
  tableName: pulumi.Input<string>; bucketName: pulumi.Input<string>; secretArn: pulumi.Input<string>;
  queueArn: pulumi.Input<string>;
}) {
  // 1. Two handlers, ONE published worker image. The ticket function is outside the VPC:
  //    all facts travel in the event; only AWS APIs are needed, no NAT or security-group rules.
  const fn = new aws.lambda.Function("minitickets-dev-tickets", {
    name: "minitickets-dev-tickets", packageType: "Image", imageUri: inputs.image,
    imageConfig: { commands: ["ticket-lambda.handler"] }, architectures: ["arm64"],
    role: inputs.roleArn, memorySize: 512, timeout: 30,
    environment: { variables: { NODE_ENV: "production", TICKETS_TABLE: inputs.tableName,
      TICKETS_BUCKET: inputs.bucketName, TICKET_SIGNING_SECRET_ID: inputs.secretArn } },
    loggingConfig: { logFormat: "Text", logGroup: inputs.logGroupName }, tags: tagsFor("minitickets-dev-tickets"),
  });
  // 2. One booking per invocation bounds up to four QR renders. Independent retries/DLQ;
  //    partial failure reporting matches the local runner. No provisioned concurrency or idle invocation cost.
  const trigger = new aws.lambda.EventSourceMapping("minitickets-dev-tickets-trigger", {
    eventSourceArn: inputs.queueArn, functionName: fn.arn,
    batchSize: 1, functionResponseTypes: ["ReportBatchItemFailures"],
    scalingConfig: { maximumConcurrency: 2 }, tags: tagsFor("minitickets-dev-tickets-trigger"),
  });
  return { functionName: fn.name, triggerId: trigger.id };
}

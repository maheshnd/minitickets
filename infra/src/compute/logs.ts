// LAYER: logs (part of the compute layer)
// NEEDS (inputs):   nothing
// CREATES:          CloudWatch log group /minitickets/dev/api
// GIVES (outputs):  logGroupName -> used by task (the container sends its output here)
//
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { tagsFor } from "../tags";

// The logs part of the compute layer: one place in CloudWatch for the api's output.
// See docs/17-infra-ecs-api.md for the diagrams.
//
// CloudWatch Logs in simple words:
//   A container's console.log / Fastify log lines disappear when the container stops. CloudWatch
//   Logs is AWS's log book: ECS copies every line there, so we can read them later (also after
//   a crash). A "log group" is one book; each container writes its own "log stream" (chapter).

const prefix = "minitickets-dev";

export interface LogsOutputs {
  logGroupName: pulumi.Output<string>;
}

export function createLogs(): LogsOutputs {
  // 1. Log group
  // WHAT: the book named /minitickets/dev/api.
  // WHY: the awslogs driver in task.ts needs a group to write to. It does not create one itself.
  // DEPENDS ON: nothing.
  // retentionInDays 7: lines older than a week are deleted automatically. Storage is billed per
  //   GB, and dev logs older than a week are never read. Without it, logs are kept FOREVER.
  //   Production: often 30-90 days (or what an audit requires).
  const logGroup = new aws.cloudwatch.LogGroup(`${prefix}-api-logs`, {
    name: "/minitickets/dev/api",
    retentionInDays: 7,
    tags: tagsFor(`${prefix}-api-logs`),
  });

  return { logGroupName: logGroup.name };
}

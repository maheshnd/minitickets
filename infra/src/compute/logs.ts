// LAYER: logs (part of the compute layer)
// NEEDS (inputs):   service: "api" or "web" (which app the log group is for)
// CREATES:          CloudWatch log group /minitickets/dev/<service>
// GIVES (outputs):  logGroupName -> used by task / web-task (the container sends its output here)
//
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { tagsFor } from "../tags";

// The logs part of the compute layer: one place in CloudWatch for one app's output.
// Called once for the api (compute switch) and once for web (entry switch).
// See docs/17-infra-ecs-api.md and docs/18-infra-alb-web.md for the diagrams.
//
// CloudWatch Logs in simple words:
//   A container's console.log / Fastify log lines disappear when the container stops. CloudWatch
//   Logs is AWS's log book: ECS copies every line there, so we can read them later (also after
//   a crash). A "log group" is one book; each container writes its own "log stream" (chapter).

const prefix = "minitickets-dev";

export interface LogsOutputs {
  logGroupName: pulumi.Output<string>;
}

// @concept: cloudwatch-logs
export function createLogs(service: "api" | "web"): LogsOutputs {
  // 1. Log group
  // WHAT: the book named /minitickets/dev/api (or /minitickets/dev/web).
  // WHY: the awslogs driver in task.ts / web-task.ts needs a group to write to. It does not
  //      create one itself. One group per app keeps the api and web lines apart.
  // DEPENDS ON: nothing.
  // retentionInDays 7: lines older than a week are deleted automatically. Storage is billed per
  //   GB, and dev logs older than a week are never read. Without it, logs are kept FOREVER.
  //   Production: often 30-90 days (or what an audit requires).
  const logGroup = new aws.cloudwatch.LogGroup(`${prefix}-${service}-logs`, {
    name: `/minitickets/dev/${service}`,
    retentionInDays: 7,
    tags: tagsFor(`${prefix}-${service}-logs`),
  });

  return { logGroupName: logGroup.name };
}

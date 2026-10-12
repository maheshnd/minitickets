// LAYER: target-groups (part of the entry layer)
// NEEDS (inputs):   vpcId <- from network
// CREATES:          2 target groups: api (port 4000, checks /health), web (port 3000, checks /)
// GIVES (outputs):  apiTargetGroupArn, webTargetGroupArn -> used by listener (which passes
//                   them on to the api and web services once they are attached to the ALB)
//
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { tagsFor } from "../tags";

// The target group part of the entry layer.
// See docs/18-infra-alb-web.md for the diagrams.
//
// Target group in simple words:
//   A list of the desks (task IP addresses) that can handle one kind of request, plus a rule for
//   checking that each desk is staffed (the health check). The ECS service adds a task to the list
//   when it starts and removes it when it stops. The ALB only sends traffic to HEALTHY entries.

const prefix = "minitickets-dev";

export interface TargetGroupsInputs {
  vpcId: pulumi.Input<string>;
}

export interface TargetGroupsOutputs {
  apiTargetGroupArn: pulumi.Output<string>;
  webTargetGroupArn: pulumi.Output<string>;
}

// @concept: target-groups
export function createTargetGroups(inputs: TargetGroupsInputs): TargetGroupsOutputs {
  // @concept: load-balancing-algorithms
  // @concept: zero-downtime-deploys
  // @concept: graceful-shutdown
  // 1. Settings both target groups share.
  //    targetType "ip": Fargate tasks have their own IPs (awsvpc network mode gives every task its
  //      own network card). There is no EC2 instance to point at, so the list holds task IPs.
  //      The other common value, "instance", only works when containers run on our own EC2 machines.
  //    deregistrationDelay 30: when a task is stopping, the ALB stops sending it NEW requests at
  //      once, but keeps it in the list for 30 seconds ("draining") so requests already in flight
  //      can finish. For a normal deploy (and a scale-in) this order is confirmed from the AWS
  //      docs: draining first, then ECS sends SIGTERM, and our graceful shutdown
  //      (docs/05-database.md, docs/11-docker.md) closes cleanly. For a Spot interruption the
  //      AWS docs do NOT say that draining finishes before SIGTERM, so do not rely on it there.
  //      See docs/handbook/concepts/graceful-shutdown.md.
  //      The default is 300 s: every deploy would wait 5 minutes for nothing. Our requests take
  //      milliseconds, so 30 s is plenty.
  //    No `name`: Pulumi adds a random suffix (minitickets-dev-api-tg-1a2b3c4). Some changes (like
  //      the port) REPLACE a target group, and Pulumi creates the new one before deleting the old
  //      one. Two target groups cannot share a name, so a fixed name would make that replace fail.
  const shared = {
    vpcId: inputs.vpcId,
    targetType: "ip",
    protocol: "HTTP",
    deregistrationDelay: 30,
  };

  // @concept: health-checks
  // 2. Health check timing, the same for both.
  //    Every 15 s the ALB calls the path on every task. Answer within 5 s with HTTP 200 = pass.
  //    2 passes in a row = healthy (gets traffic). 3 failures in a row = unhealthy (no traffic,
  //    and the ECS service replaces the task).
  const healthCheckTiming = {
    protocol: "HTTP",
    matcher: "200",
    interval: 15,
    timeout: 5,
    healthyThreshold: 2,
    unhealthyThreshold: 3,
  };

  // 3. api target group
  // WHAT: the list of api task IPs, on port 4000.
  // WHY: the listener rule sends /trpc/* here.
  // DEPENDS ON: vpcId (a target group belongs to one VPC).
  // /health, not /ready (same reason as the container health check in compute/task.ts): a short
  //   database hiccup must not take every api task out of the ALB.
  const apiTargetGroup = new aws.lb.TargetGroup(`${prefix}-api-tg`, {
    ...shared,
    port: 4000,
    healthCheck: { ...healthCheckTiming, path: "/health" },
    tags: tagsFor(`${prefix}-api-tg`),
  });

  // 4. web target group
  // WHAT: the list of web (Next.js) task IPs, on port 3000.
  // WHY: the listener's web rule (priority 200, entry/listener.ts) sends everything that is not
  //      /trpc/* here. (Before Step 11g that was the listener's default action.)
  // DEPENDS ON: vpcId.
  // / is the landing page: a plain server-rendered page that needs no database or api,
  //   so it answers 200 whenever Next.js itself is up.
  const webTargetGroup = new aws.lb.TargetGroup(`${prefix}-web-tg`, {
    ...shared,
    port: 3000,
    healthCheck: { ...healthCheckTiming, path: "/" },
    tags: tagsFor(`${prefix}-web-tg`),
  });

  return {
    apiTargetGroupArn: apiTargetGroup.arn,
    webTargetGroupArn: webTargetGroup.arn,
  };
}

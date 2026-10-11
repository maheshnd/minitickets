// LAYER: listener (part of the entry layer)
// NEEDS (inputs):   albArn                              <- from alb
//                   apiTargetGroupArn, webTargetGroupArn <- from target-groups
// CREATES:          HTTP :80 listener (default -> web), then 1 rule (/trpc/* -> api)
// GIVES (outputs):  apiTargetGroupArn -> used by the api service (returned only once the rule exists)
//                   webTargetGroupArn -> used by the web service (returned only once the listener exists)
//
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { tagsFor } from "../tags";

// The listener part of the entry layer: where the routing decisions live.
// See docs/18-infra-alb-web.md for the diagrams.
//
// Listener and rule in simple words:
//   The LISTENER is the receptionist's ear on one door (port 80). Its RULES are the signboard:
//   "path starts with /trpc/ -> api desk". When no rule matches, the DEFAULT ACTION applies:
//   "everyone else -> web desk".
//
// This is the same-origin routing from docs/16-infra-ecr.md: the web image calls "/trpc" on the
// same address that served the page, and this rule sends those calls to the api.

const prefix = "minitickets-dev";

export interface ListenerInputs {
  albArn: pulumi.Input<string>;
  apiTargetGroupArn: pulumi.Input<string>;
  webTargetGroupArn: pulumi.Input<string>;
}

export interface ListenerOutputs {
  apiTargetGroupArn: pulumi.Output<string>;
  webTargetGroupArn: pulumi.Output<string>;
}

export function createListener(inputs: ListenerInputs): ListenerOutputs {
  // 1. HTTP listener on port 80
  // WHAT: accept plain HTTP on port 80. Default action: forward to the web target group.
  // WHY: web is the "everything else" case (pages, /_next/static files, /login, /dashboard ...).
  // DEPENDS ON: the ALB and the web target group.
  // HTTP only for now: HTTPS needs a certificate for a domain name we own. Step 11g puts
  //   CloudFront (with HTTPS) in front of this ALB. Until then the session cookie, which is
  //   Secure in production, is not saved by the browser over http, so login cannot work yet.
  const listener = new aws.lb.Listener(`${prefix}-http`, {
    loadBalancerArn: inputs.albArn,
    port: 80,
    protocol: "HTTP",
    defaultActions: [{ type: "forward", targetGroupArn: inputs.webTargetGroupArn }],
    tags: tagsFor(`${prefix}-http`),
  });

  // 2. Rule: /trpc/* -> api
  // WHAT: if the path matches /trpc/* (e.g. /trpc/auth.login?batch=1), forward to the api
  //       target group instead.
  // WHY: the browser calls the api on the same origin as the page, so the ALB must split by path.
  // DEPENDS ON: the listener and the api target group.
  // priority: rules are checked from the lowest number up; the first match wins. We have one rule,
  //   so the number only matters later, when more rules are added.
  const trpcRule = new aws.lb.ListenerRule(`${prefix}-trpc-rule`, {
    listenerArn: listener.arn,
    priority: 100,
    conditions: [{ pathPattern: { values: ["/trpc/*"] } }],
    actions: [{ type: "forward", targetGroupArn: inputs.apiTargetGroupArn }],
    tags: tagsFor(`${prefix}-trpc-rule`),
  });

  // 3. Return each target group ARN only once it is connected to the ALB (same idea as
  //    compute/cluster.ts step 3).
  //    WHY: ECS refuses to create a service with a target group that no load balancer uses yet
  //    ("target group ... does not have an associated load balancer"). The web group is connected
  //    by the listener's default action, the api group only by the rule. pulumi.all waits for
  //    both values in the list; we then keep just the ARN.
  return {
    apiTargetGroupArn: pulumi.all([inputs.apiTargetGroupArn, trpcRule.id]).apply(([arn]) => arn),
    webTargetGroupArn: pulumi.all([inputs.webTargetGroupArn, listener.id]).apply(([arn]) => arn),
  };
}

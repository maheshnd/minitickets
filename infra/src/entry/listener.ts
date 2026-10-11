// LAYER: listener (part of the entry layer)
// NEEDS (inputs):   albArn                              <- from alb
//                   apiTargetGroupArn, webTargetGroupArn <- from target-groups
//                   originHeaderName, originHeaderValue  <- from origin-secret
// CREATES:          HTTP :80 listener (default -> fixed 403), then 2 rules:
//                   secret header + /trpc/* -> api, secret header -> web
// GIVES (outputs):  apiTargetGroupArn -> used by the api service (returned only once its rule exists)
//                   webTargetGroupArn -> used by the web service (returned only once its rule exists)
//
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { tagsFor } from "../tags";

// The listener part of the entry layer: where the routing decisions live.
// See docs/18-infra-alb-web.md (routing) and docs/19-infra-cloudfront.md (the secret header).
//
// Listener and rule in simple words:
//   The LISTENER is the receptionist's ear on one door (port 80). Its RULES are the signboard:
//   "knows the password AND path starts with /trpc/ -> api desk", "knows the password -> web
//   desk". When no rule matches, the DEFAULT ACTION applies: "403, go away".
//
// This is the same-origin routing from docs/16-infra-ecr.md: the web image calls "/trpc" on the
// same address that served the page, and the first rule sends those calls to the api.
//
// Two locks keep everyone except our CloudFront distribution out (docs/19-infra-cloudfront.md):
//   1. the alb security group lets in only CloudFront's IP ranges (security.ts, rule 6).
//      That blocks every request that does not come from CloudFront.
//   2. the secret header checked by the rules below. That blocks OTHER people's CloudFront
//      distributions: they use the same IP ranges as ours, so lock 1 alone lets them in.

const prefix = "minitickets-dev";

export interface ListenerInputs {
  albArn: pulumi.Input<string>;
  apiTargetGroupArn: pulumi.Input<string>;
  webTargetGroupArn: pulumi.Input<string>;
  originHeaderName: string;
  originHeaderValue: pulumi.Input<string>;
}

export interface ListenerOutputs {
  apiTargetGroupArn: pulumi.Output<string>;
  webTargetGroupArn: pulumi.Output<string>;
}

export function createListener(inputs: ListenerInputs): ListenerOutputs {
  // 1. HTTP listener on port 80
  // WHAT: accept plain HTTP on port 80. Default action: answer 403 Forbidden ourselves, without
  //       asking any task.
  // WHY: the default is what happens when NO rule matches, and both rules below need the secret
  //      header. So "no secret" = 403. Safe by default: a request reaches a task only if a rule
  //      explicitly says so.
  // DEPENDS ON: the ALB.
  // HTTP, not HTTPS: CloudFront talks to the ALB over plain HTTP (see entry/cdn.ts, origin).
  //   The browser's HTTPS connection ends at CloudFront.
  const listener = new aws.lb.Listener(`${prefix}-http`, {
    loadBalancerArn: inputs.albArn,
    port: 80,
    protocol: "HTTP",
    defaultActions: [
      {
        type: "fixed-response",
        fixedResponse: { statusCode: "403", contentType: "text/plain", messageBody: "Forbidden" },
      },
    ],
    tags: tagsFor(`${prefix}-http`),
  });

  // 2. The condition both rules share: "the request carries our secret header".
  //    CloudFront adds it to every request it sends to the ALB (entry/cdn.ts).
  const hasSecretHeader = {
    httpHeader: { httpHeaderName: inputs.originHeaderName, values: [inputs.originHeaderValue] },
  };

  // 3. Rule: secret header AND /trpc/* -> api
  // WHAT: if the request has the secret header and the path matches /trpc/*
  //       (e.g. /trpc/auth.login?batch=1), forward to the api target group.
  // WHY: the browser calls the api on the same origin as the page, so the ALB must split by path.
  //      All conditions in one rule must match (AND).
  // DEPENDS ON: the listener and the api target group.
  // priority: rules are checked from the lowest number up; the first match wins. /trpc/* must be
  //   checked BEFORE the "everything else" web rule (4), so it gets the lower number.
  const trpcRule = new aws.lb.ListenerRule(`${prefix}-trpc-rule`, {
    listenerArn: listener.arn,
    priority: 100,
    conditions: [hasSecretHeader, { pathPattern: { values: ["/trpc/*"] } }],
    actions: [{ type: "forward", targetGroupArn: inputs.apiTargetGroupArn }],
    tags: tagsFor(`${prefix}-trpc-rule`),
  });

  // 4. Rule: secret header -> web
  // WHAT: any other request with the secret header goes to the web target group.
  // WHY: web is the "everything else" case (pages, /_next/static files, /login, /dashboard ...).
  //      Until Step 11g this was the listener's default action. It moved into a rule because the
  //      default must now be the 403.
  // DEPENDS ON: the listener and the web target group.
  const webRule = new aws.lb.ListenerRule(`${prefix}-web-rule`, {
    listenerArn: listener.arn,
    priority: 200,
    conditions: [hasSecretHeader],
    actions: [{ type: "forward", targetGroupArn: inputs.webTargetGroupArn }],
    tags: tagsFor(`${prefix}-web-rule`),
  });

  // 5. Return each target group ARN only once it is connected to the ALB (same idea as
  //    compute/cluster.ts step 3).
  //    WHY: ECS refuses to create a service with a target group that no load balancer uses yet
  //    ("target group ... does not have an associated load balancer"). Each group is now
  //    connected only by its rule (the default action uses no target group), so we wait for the
  //    rule. pulumi.all waits for both values in the list; we then keep just the ARN.
  return {
    apiTargetGroupArn: pulumi.all([inputs.apiTargetGroupArn, trpcRule.id]).apply(([arn]) => arn),
    webTargetGroupArn: pulumi.all([inputs.webTargetGroupArn, webRule.id]).apply(([arn]) => arn),
  };
}

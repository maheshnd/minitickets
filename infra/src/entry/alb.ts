// LAYER: alb (part of the entry layer)
// NEEDS (inputs):   publicSubnetIds <- from network
//                   albSgId         <- from security
// CREATES:          Application Load Balancer minitickets-dev (internet-facing)
// GIVES (outputs):  albArn     -> used by listener
//                   albDnsName -> used by cdn (its origin) and as a stack output (in ALB-only
//                                 mode your domain's CNAME points at it)
//
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { tagsFor } from "../tags";

// The load balancer part of the entry layer.
// See docs/18-infra-alb-web.md for the diagrams.
//
// Application Load Balancer (ALB) in simple words:
//   The receptionist at the front door of our office building. Every visitor from the internet
//   talks to the receptionist, never to the staff directly. The receptionist reads what the
//   visitor asks for (the URL path) and walks them to the right desk (web or api).
//   On its own the ALB routes nothing: the listener (listener.ts) holds the routing rules.
//   Since Step 11g visitors never reach it directly: CloudFront (cdn.ts) stands in front of it.
//   Since Step 11i that is one of two modes: with cdnEnabled = false visitors DO reach it directly,
//   over HTTPS on our own domain (https-listener.ts). The ALB itself is the same in both modes.

const prefix = "minitickets-dev";

export interface AlbInputs {
  publicSubnetIds: pulumi.Input<string>[];
  albSgId: pulumi.Input<string>;
}

export interface AlbOutputs {
  albArn: pulumi.Output<string>;
  albDnsName: pulumi.Output<string>;
}

// @concept: alb
export function createAlb(inputs: AlbInputs): AlbOutputs {
  // 1. The load balancer
  // WHAT: an ALB named minitickets-dev with one node in each public subnet.
  // WHY: it is the single public entry point. Web and api tasks only accept traffic from the
  //      alb security group (docs/13-infra-security-groups.md), so all requests come through here.
  // DEPENDS ON: the public subnets (network) and the alb security group (security).
  const alb = new aws.lb.LoadBalancer(`${prefix}-alb`, {
    name: prefix,

    // 1a. "application" = an ALB: it understands HTTP and can route by path. (The other kind,
    //     "network", only forwards TCP connections and cannot read a URL.)
    loadBalancerType: "application",

    // 1b. internal: false = internet-facing. AWS gives it public IP addresses and a public DNS
    //     name. That is why it must sit in the PUBLIC subnets (they have a route to the internet
    //     gateway). An ALB needs subnets in at least 2 availability zones; we have exactly 2.
    internal: false,
    subnets: inputs.publicSubnetIds,

    // 1c. It wears the alb badge: port 80 open only to CloudFront (Step 11g), or ports 80 and 443
    //     open to allowedCidrs without CloudFront (Step 11i), and allowed out to web and api.
    securityGroups: [inputs.albSgId],

    // 1d. Drop requests with malformed HTTP headers instead of passing them on.
    //     WHY: a cheap defence against "request smuggling" tricks that confuse the server behind.
    dropInvalidHeaderFields: true,

    // 1e. Dev only: the stack must be able to delete it when the switch goes off.
    //     Production turns deletion protection on so nobody deletes it by accident.
    enableDeletionProtection: false,

    tags: tagsFor(`${prefix}-alb`),
  });

  return { albArn: alb.arn, albDnsName: alb.dnsName };
}

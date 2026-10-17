// LAYER: security
// NEEDS (inputs):   vpcId <- from network
// CREATES:          5 security groups (alb, web, api, db, redis), then 5 ingress rules
//                   (alb 80 from CloudFront only [only when cdnEnabled], web 3000, api 4000,
//                   db 5432, redis 6379), then 3 egress rules (alb, web, api)
// GIVES (outputs):  albSgId   -> used by alb (entry layer)
//                   webSgId   -> used by web-service (web tasks)
//                   apiSgId   -> used by service (api tasks)
//                   dbSgId    -> used by postgres
//                   redisSgId -> used by cache
//
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { tagsFor } from "./tags";
import { prefix } from "./stack";

// The security layer: 5 security groups (firewalls) and the rules between them.
// See docs/13-infra-security-groups.md for the diagrams.
//
// Security group in simple words:
//   A security group is a firewall attached to a resource (a load balancer, a container,
//   a database). It lists what is ALLOWED. Anything not listed is blocked.
//   It is "stateful": if a request is allowed in, the reply is allowed out automatically.
//
// WHY source groups, not IP ranges:
//   Containers get a new IP address every time they restart or scale. An IP range like
//   10.0.10.0/24 would be too wide (every machine in it gets access) and would break when
//   things move. A rule that says "allow from the api group" always means "whatever is
//   wearing the api badge right now", whatever its IP is. Least privilege: only the exact
//   caller we expect can reach each door.

export interface SecurityInputs {
  vpcId: pulumi.Input<string>;
  // Step 11i: false = no CloudFront in front of the ALB, so rule 6 (CloudFront only) is left out.
  // The ALB's doors for that mode are opened by the entry layer (entry/alb-public-ingress.ts).
  cdnEnabled: boolean;
}

export interface SecurityOutputs {
  albSgId: pulumi.Output<string>;
  webSgId: pulumi.Output<string>;
  apiSgId: pulumi.Output<string>;
  dbSgId: pulumi.Output<string>;
  redisSgId: pulumi.Output<string>;
}

// @concept: security-groups
// @concept: least-privilege
export function createSecurityGroups(inputs: SecurityInputs): SecurityOutputs {
  // 1. alb group
  // WHAT: the firewall for the load balancer. Since Step 11g only CloudFront may talk to it.
  // WHY: it is the single entry point into the VPC. Everything else hides behind it.
  // DEPENDS ON: inputs.vpcId (from network).
  // The description below is out of date (it predates CloudFront), but we keep it on purpose:
  //   AWS cannot change a security group's description, so a new one would REPLACE the group,
  //   and with it every rule and every resource that wears it. The rules below are the truth.
  const albSg = new aws.ec2.SecurityGroup(`${prefix}-alb-sg`, {
    vpcId: inputs.vpcId,
    description: "Load balancer: open to the internet on 80 and 443",
    tags: tagsFor(`${prefix}-alb-sg`),
  });

  // 2. web group
  // WHAT: the firewall for the Next.js containers.
  // WHY: only the load balancer should be able to send them traffic.
  // DEPENDS ON: inputs.vpcId.
  const webSg = new aws.ec2.SecurityGroup(`${prefix}-web-sg`, {
    vpcId: inputs.vpcId,
    description: "Web containers: reachable only from the load balancer",
    tags: tagsFor(`${prefix}-web-sg`),
  });

  // 3. api group
  // WHAT: the firewall for the Fastify API containers.
  // WHY: only the load balancer should be able to send them traffic.
  // DEPENDS ON: inputs.vpcId.
  const apiSg = new aws.ec2.SecurityGroup(`${prefix}-api-sg`, {
    vpcId: inputs.vpcId,
    description: "API containers: reachable only from the load balancer",
    tags: tagsFor(`${prefix}-api-sg`),
  });

  // 4. db group
  // WHAT: the firewall for Postgres.
  // WHY: only the api may ask the database questions. Not web, not the internet.
  // DEPENDS ON: inputs.vpcId.
  // egress: [] removes the "allow all outbound" rule AWS adds to every new group.
  //   Postgres never starts connections to anyone, so it gets no outbound rules at all.
  //   Replies still work because security groups are stateful.
  const dbSg = new aws.ec2.SecurityGroup(`${prefix}-db-sg`, {
    vpcId: inputs.vpcId,
    description: "Postgres: reachable only from the api",
    egress: [],
    tags: tagsFor(`${prefix}-db-sg`),
  });

  // 5. redis group
  // WHAT: the firewall for Redis.
  // WHY: only the api may use it.
  // DEPENDS ON: inputs.vpcId.
  // egress: [] for the same reason as the db group.
  const redisSg = new aws.ec2.SecurityGroup(`${prefix}-redis-sg`, {
    vpcId: inputs.vpcId,
    description: "Redis: reachable only from the api",
    egress: [],
    tags: tagsFor(`${prefix}-redis-sg`),
  });

  // ---------- Ingress rules (who may come IN) ----------
  // A rule needs BOTH groups to exist first: the group it protects and (if any) the group
  // it allows. That is why rules are separate resources created after the groups.

  // @concept: origin-protection
  // 6. alb: HTTP from CloudFront only (changed in Step 11g, see docs/19-infra-cloudfront.md)
  // WHAT: the AWS managed prefix list "com.amazonaws.global.cloudfront.origin-facing": the list
  //       of IP ranges CloudFront uses to call origins. AWS keeps it up to date for us.
  //       A prefix list is a named list of IP ranges that one rule can point at.
  // WHY: only CloudFront should reach the ALB. A visitor who finds the ALB's DNS name and calls
  //      it directly gets no answer at all (the connection times out), so nobody can skip
  //      CloudFront's HTTPS. This is lock 1 of 2; lock 2 is the secret header (entry/listener.ts).
  // DEPENDS ON: albSg and the prefix list lookup (a read, not a resource we create).
  // Quota: one rule that points at a prefix list counts as as many rules as the list's maximum
  //   size. AWS counts this list as 55, and a group may hold 60 inbound rules. That is one reason
  //   the old 443 rule is gone: nothing listens on 443 (CloudFront talks to the ALB on 80).
  //   Plain 0.0.0.0/0 rules for 80 and 443 are gone too: the internet may no longer call the ALB.
  // Only in CloudFront mode (cdnEnabled, Step 11i). Without CloudFront, letting its IP ranges in
  //   would only open a door nobody of ours uses (any CloudFront distribution, not just ours, uses
  //   those ranges). Same name and settings as before, so with cdnEnabled = true nothing changes.
  if (inputs.cdnEnabled) {
    const cloudFrontPrefixList = aws.ec2.getManagedPrefixListOutput({
      name: "com.amazonaws.global.cloudfront.origin-facing",
    });
    new aws.vpc.SecurityGroupIngressRule(`${prefix}-alb-in-80`, {
      securityGroupId: albSg.id,
      description: "HTTP from CloudFront only",
      ipProtocol: "tcp",
      fromPort: 80,
      toPort: 80,
      prefixListId: cloudFrontPrefixList.id,
      tags: tagsFor(`${prefix}-alb-in-80`),
    });
  }

  // 7. (Removed in Step 11g: "alb: HTTPS 443 from the internet". See rule 6 for why.)

  // 8. web: port 3000 from the alb group only
  // WHAT: let the load balancer forward requests to the Next.js containers.
  // WHY: source = the alb GROUP, not an IP range (see the top of this file).
  // DEPENDS ON: webSg (protected) and albSg (allowed source).
  new aws.vpc.SecurityGroupIngressRule(`${prefix}-web-in-3000`, {
    securityGroupId: webSg.id,
    description: "Next.js from the load balancer",
    ipProtocol: "tcp",
    fromPort: 3000,
    toPort: 3000,
    referencedSecurityGroupId: albSg.id,
    tags: tagsFor(`${prefix}-web-in-3000`),
  });

  // 9. api: port 4000 from the alb group only
  // WHAT: let the load balancer forward requests to the Fastify containers.
  // WHY: same as above. Only the load balancer is a valid caller.
  // DEPENDS ON: apiSg and albSg.
  new aws.vpc.SecurityGroupIngressRule(`${prefix}-api-in-4000`, {
    securityGroupId: apiSg.id,
    description: "Fastify from the load balancer",
    ipProtocol: "tcp",
    fromPort: 4000,
    toPort: 4000,
    referencedSecurityGroupId: albSg.id,
    tags: tagsFor(`${prefix}-api-in-4000`),
  });

  // 10. db: Postgres port from the api group only
  // WHAT: let the api connect to Postgres.
  // WHY: the api is the only code allowed to touch the data store (see CLAUDE.md layers).
  //      The firewall enforces the same rule at the network level.
  // DEPENDS ON: dbSg and apiSg.
  new aws.vpc.SecurityGroupIngressRule(`${prefix}-db-in-5432`, {
    securityGroupId: dbSg.id,
    description: "Postgres from the api",
    ipProtocol: "tcp",
    fromPort: 5432,
    toPort: 5432,
    referencedSecurityGroupId: apiSg.id,
    tags: tagsFor(`${prefix}-db-in-5432`),
  });

  // 11. redis: Redis port from the api group only
  // WHAT: let the api connect to Redis.
  // WHY: same reason as Postgres.
  // DEPENDS ON: redisSg and apiSg.
  new aws.vpc.SecurityGroupIngressRule(`${prefix}-redis-in-6379`, {
    securityGroupId: redisSg.id,
    description: "Redis from the api",
    ipProtocol: "tcp",
    fromPort: 6379,
    toPort: 6379,
    referencedSecurityGroupId: apiSg.id,
    tags: tagsFor(`${prefix}-redis-in-6379`),
  });

  // ---------- Egress rules (who we may call OUT) ----------
  // db and redis have none (see their groups above).

  // 12. alb, web, api: allow all outbound
  // WHAT: one rule per group allowing every protocol to every IPv4 address.
  // WHY: the load balancer must reach web and api, the api must reach db, redis and AWS
  //      APIs, and the containers must pull images from ECR. Listing every destination now
  //      would be long and brittle, so outbound stays open for these three.
  // DEPENDS ON: the group each rule belongs to.
  const openEgress = [
    { name: "alb", group: albSg },
    { name: "web", group: webSg },
    { name: "api", group: apiSg },
  ];
  openEgress.forEach(({ name, group }) => {
    new aws.vpc.SecurityGroupEgressRule(`${prefix}-${name}-out-all`, {
      securityGroupId: group.id,
      description: "All outbound",
      ipProtocol: "-1", // -1 means every protocol and every port
      cidrIpv4: "0.0.0.0/0",
      tags: tagsFor(`${prefix}-${name}-out-all`),
    });
  });

  // 13. What later layers need. index.ts passes these on; no other file imports them.
  return {
    albSgId: albSg.id,
    webSgId: webSg.id,
    apiSgId: apiSg.id,
    dbSgId: dbSg.id,
    redisSgId: redisSg.id,
  };
}

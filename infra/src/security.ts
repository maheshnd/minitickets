import * as aws from "@pulumi/aws";
import { tagsFor } from "./tags";
import { vpcId } from "./network";

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

const prefix = "minitickets-dev";

// 1. alb group
// WHAT: the firewall for the load balancer, the only thing the internet may talk to.
// WHY: it is the single public entry point. Everything else hides behind it.
// DEPENDS ON: vpcId (network.ts).
const albSg = new aws.ec2.SecurityGroup(`${prefix}-alb-sg`, {
  vpcId,
  description: "Load balancer: open to the internet on 80 and 443",
  tags: tagsFor(`${prefix}-alb-sg`),
});

// 2. web group
// WHAT: the firewall for the Next.js containers.
// WHY: only the load balancer should be able to send them traffic.
// DEPENDS ON: vpcId.
const webSg = new aws.ec2.SecurityGroup(`${prefix}-web-sg`, {
  vpcId,
  description: "Web containers: reachable only from the load balancer",
  tags: tagsFor(`${prefix}-web-sg`),
});

// 3. api group
// WHAT: the firewall for the Fastify API containers.
// WHY: only the load balancer should be able to send them traffic.
// DEPENDS ON: vpcId.
const apiSg = new aws.ec2.SecurityGroup(`${prefix}-api-sg`, {
  vpcId,
  description: "API containers: reachable only from the load balancer",
  tags: tagsFor(`${prefix}-api-sg`),
});

// 4. db group
// WHAT: the firewall for Postgres.
// WHY: only the api may ask the database questions. Not web, not the internet.
// DEPENDS ON: vpcId.
// egress: [] removes the "allow all outbound" rule AWS adds to every new group.
//   Postgres never starts connections to anyone, so it gets no outbound rules at all.
//   Replies still work because security groups are stateful.
const dbSg = new aws.ec2.SecurityGroup(`${prefix}-db-sg`, {
  vpcId,
  description: "Postgres: reachable only from the api",
  egress: [],
  tags: tagsFor(`${prefix}-db-sg`),
});

// 5. redis group
// WHAT: the firewall for Redis.
// WHY: only the api may use it.
// DEPENDS ON: vpcId.
// egress: [] for the same reason as the db group.
const redisSg = new aws.ec2.SecurityGroup(`${prefix}-redis-sg`, {
  vpcId,
  description: "Redis: reachable only from the api",
  egress: [],
  tags: tagsFor(`${prefix}-redis-sg`),
});

// ---------- Ingress rules (who may come IN) ----------
// A rule needs BOTH groups to exist first: the group it protects and (if any) the group
// it allows. That is why rules are separate resources created after the groups.

// 6. alb: HTTP from the internet
// WHAT: allow port 80 from every IPv4 address.
// WHY: this is the one door the public is meant to use. (Port 80 will later redirect to 443.)
// DEPENDS ON: albSg.
new aws.vpc.SecurityGroupIngressRule(`${prefix}-alb-in-80`, {
  securityGroupId: albSg.id,
  description: "HTTP from the internet",
  ipProtocol: "tcp",
  fromPort: 80,
  toPort: 80,
  cidrIpv4: "0.0.0.0/0",
  tags: tagsFor(`${prefix}-alb-in-80`),
});

// 7. alb: HTTPS from the internet
// WHAT: allow port 443 from every IPv4 address.
// WHY: encrypted web traffic. This is what users will really use.
// DEPENDS ON: albSg.
new aws.vpc.SecurityGroupIngressRule(`${prefix}-alb-in-443`, {
  securityGroupId: albSg.id,
  description: "HTTPS from the internet",
  ipProtocol: "tcp",
  fromPort: 443,
  toPort: 443,
  cidrIpv4: "0.0.0.0/0",
  tags: tagsFor(`${prefix}-alb-in-443`),
});

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

// 13. What later layers will import (index.ts exports these as stack outputs).
export const albSgId = albSg.id;
export const webSgId = webSg.id;
export const apiSgId = apiSg.id;
export const dbSgId = dbSg.id;
export const redisSgId = redisSg.id;

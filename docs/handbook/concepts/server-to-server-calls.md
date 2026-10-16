# Server-to-server calls (web server → API)

History: see [CHANGELOG.md](../CHANGELOG.md) or run `pnpm docs:history`

Area: Frontend · Status: ✅ built in repository; live AWS acceptance is separate

## 1. In one line

API_INTERNAL_URL is runtime server-only configuration: localhost locally, api:4000 via Docker/Service Connect on AWS. The browser uses same-origin /trpc on AWS and never resolves internal service names.

## 2. Real-life comparison

Road signs find the right building, guards allow the right door and staff badges allow specific service actions.

## 3. Picture it

```mermaid
flowchart LR
    n0["Browser HTTPS ALB"] --> n1
    n1["Target SG and task ENI"] --> n2
    n2["API private route"] --> n3
    n3["DB SG and credentials"]
```

## 4. Where in our code

- Anchor: `.github/workflows/ci.yml` — `module configuration`; follow the numbered comments at this boundary.
- Anchor: `apps/web/src/lib/server-env.ts` — `ServerEnvSchema`; follow the numbered comments at this boundary.
- Anchor: `apps/web/src/lib/trpc/server.ts` — `getServerTrpc`; follow the numbered comments at this boundary.
- Anchor: `docker-compose.yml` — `module configuration`; follow the numbered comments at this boundary.

`infra/src/network.ts` defines routes; `security.ts` allows ALB→web/API and API→Postgres/Valkey. `compute/service-connect.ts` defines namespace aliases. API_INTERNAL_URL is for web server code; browser tRPC uses same-origin ALB routing. Read `infra/src/compute/service-connect.ts` and follow the private-name console tour.

## 5. See it yourself

Use the linked scenario and tour to trace the existing integration point. This proposed extension has no runnable feature demo.

Failure thought experiment: Can browser JS call the Service Connect hostname? No; it is private service discovery for tasks. Do not change a live stack to demonstrate it.

## 6. How it connects

Uses the [current system](../00-big-picture.md); gives a concrete decision to the [scenario](../guides/interview-scenarios.md#network-boundaries) and [explorer tour](../guides/infra-explorer.html?tour=database-reach).

## 7. Our settings and WHY

API_INTERNAL_URL is runtime server-only configuration: localhost locally, api:4000 via Docker/Service Connect on AWS. The browser uses same-origin /trpc on AWS and never resolves internal service names. A valid password cannot repair a missing route or blocked SG.

## 8. Trade-offs

Public ECS task IPs avoid NAT in this small design but require strict inbound SGs. Private subnets with NAT/endpoints change cost and reach.

## 9. Alternatives and when to choose them

10x: map all egress and proxy trust. 100x: segmentation, IPv6/endpoints and flow logs after a concrete need.

## 10. What breaks and how we notice

Can browser JS call the Service Connect hostname? No; it is private service discovery for tasks.

## 13. Interview answers at 3 levels

- **Simple:** API_INTERNAL_URL is runtime server-only configuration: localhost locally, api:4000 via Docker/Service Connect on AWS.
- **Senior:** First prove reach: address, route, subnet and listener. Then prove allowed: SG source/port and IAM for service APIs. Finally prove credentials. SGs are stateful; NACLs are subnet-level/stateless. An ENI is the task’s network interface. Service Connect gives web/api private names and ports without exposing internal traffic through a public browser URL.
- **Lead:** 10x: map all egress and proxy trust. 100x: segmentation, IPv6/endpoints and flow logs after a concrete need.

## 14. Follow-up questions with answers

Can browser JS call the Service Connect hostname? No; it is private service discovery for tasks.

Which control is stateful? **Security group.**

## 15. Say it in 30 seconds

First prove reach: address, route, subnet and listener. Then prove allowed: SG source/port and IAM for service APIs. Finally prove credentials. SGs are stateful; NACLs are subnet-level/stateless. An ENI is the task’s network interface. Service Connect gives web/api private names and ports without exposing internal traffic through a public browser URL.

## 16. Status and production work

Repository implementation and local evidence are described above. Live AWS/CI execution remains owner acceptance. 10x: map all egress and proxy trust. 100x: segmentation, IPv6/endpoints and flow logs after a concrete need.

## Where it appears in the story

- [infra-story: 4b. Private service discovery and asynchronous workers](../infra-story.md#4b-private-service-discovery-and-asynchronous-workers)

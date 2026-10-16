# ADR 0008: Service Connect and ALB-only HTTPS without a NAT gateway

History: see [CHANGELOG.md](../CHANGELOG.md) or run `pnpm docs:history`

Status: accepted for repository implementation; live AWS acceptance remains separate.

## Context

A valid password cannot repair a missing route or blocked SG. First prove reach: address, route, subnet and listener. Then prove allowed: SG source/port and IAM for service APIs. Finally prove credentials. SGs are stateful; NACLs are subnet-level/stateless. An ENI is the task’s network interface. Service Connect gives web/api private names and ports without exposing internal traffic through a public browser URL.

## Picture the boundary

```mermaid
flowchart LR
    n0["Browser HTTPS ALB"] --> n1
    n1["Target SG and task ENI"] --> n2
    n2["API private route"] --> n3
    n3["DB SG and credentials"]
```

## Options considered

Private Cloud Map DNS; internal ALB; Service Connect; CDN-only public HTTPS.

## Decision

Use Service Connect api/web aliases with explicit proxy ingress/SGs. Keep ALB traffic on app ports. Current direct ALB HTTPS with ACM domain works while CloudFront awaits verification; public task egress avoids NAT but has guarded inbound SGs.

## Consequences

Public ECS task IPs avoid NAT in this small design but require strict inbound SGs. Private subnets with NAT/endpoints change cost and reach.

## When we would revisit

10x: map all egress and proxy trust. 100x: segmentation, IPv6/endpoints and flow logs after a concrete need.

## Evidence and connections

`infra/src/network.ts` defines routes; `security.ts` allows ALB→web/API and API→Postgres/Valkey. `compute/service-connect.ts` defines namespace aliases. API_INTERNAL_URL is for web server code; browser tRPC uses same-origin ALB routing. Read `infra/src/compute/service-connect.ts` and follow the private-name console tour.

[Scenario](../guides/interview-scenarios.md#network-boundaries) · [Tour](../guides/infra-explorer.html?tour=database-reach)

# ECR: the image registry

History: see [CHANGELOG.md](../CHANGELOG.md) or run `pnpm docs:history`

Area: AWS Compute · Status: ✅ built in repository; live acceptance is separate

## 1. In one line

Three ECR repositories hold api/web/worker. Immutable SHA tags and deployed retention tags support publish-once and rollback; Lambda pull resource policies are separate from GitHub publish permissions. CI Trivy critical gates supplement ECR scanOnPush.

## 2. Real-life comparison

A sealed package is built once, then checked at a gate before the manager installs that exact version.

## 3. Picture it

```mermaid
flowchart LR
    n0["CI tests"] --> n1
    n1["Publish SHA once"] --> n2
    n2["Approved CD plus migration"] --> n3
    n3["Roll and smoke test"]
```

## 4. Where in our code

- Anchor: `infra/src/registry.ts` · `createRepo`, `lifecyclePolicy`: two repositories, each with a lifecycle policy.

The publish job in `.github/workflows/cd.yml` builds/pushes; its deploy job resolves release and runs two-phase deploy/migrate/smoke checks. `infra/src/image-tag.ts` reads the tag; `release.ts` tracks last deployed commit. See runbook §3.11–3.18. No publish, AWS write or live rollback was performed by this documentation work.

## 5. See it yourself

The publish job in `.github/workflows/cd.yml` builds/pushes; its deploy job resolves release and runs two-phase deploy/migrate/smoke checks. `infra/src/image-tag.ts` reads the tag; `release.ts` tracks last deployed commit. See runbook §3.11–3.18. No publish, AWS write or live rollback was performed by this documentation work.

Failure thought experiment: Should rollback run old Pulumi code? No; image rollback and infrastructure rollback are different risks.

## 6. How it connects

Uses the [current system](../00-big-picture.md); gives a concrete decision to the [scenario](../guides/interview-scenarios.md#delivery-rollback) and [explorer tour](../guides/infra-explorer.html?tour=deploy).

## 7. Our settings and WHY

Three ECR repositories hold api/web/worker. Immutable SHA tags and deployed retention tags support publish-once and rollback; Lambda pull resource policies are separate from GitHub publish permissions. CI Trivy critical gates supplement ECR scanOnPush. Rebuilding on deploy can ship bytes that were never reviewed or tested.

## 8. Trade-offs

Rolling deployment overlaps versions. Blue/green gives a switchable target but costs overlap and still needs compatible migrations. Secrets/config are part of release compatibility.

## 9. Alternatives and when to choose them

10x: expired approvals and automated rollback criteria. 100x: canary analysis, immutable manifests and cross-service compatibility.

## 10. What breaks and how we notice

Should rollback run old Pulumi code? No; image rollback and infrastructure rollback are different risks.

## 13. Interview answers at 3 levels

- **Simple:** Three ECR repositories hold api/web/worker. Immutable SHA tags and deployed retention tags support publish-once and rollback; Lambda pull resource policies are separate from GitHub publish permissions. CI Trivy critical gates supplement ECR scanOnPush.
- **Senior:** Publish API/web/worker images once with the git SHA after CI, then deploy that immutable release. The environment switches live in committed Pulumi YAML; deployed image tag lives in SSM and is written by CD. Migration runs before rollout. Roll back app images to a known tag while respecting current schema and current infrastructure.
- **Lead:** 10x: expired approvals and automated rollback criteria. 100x: canary analysis, immutable manifests and cross-service compatibility.

## 14. Follow-up questions with answers

Should rollback run old Pulumi code? No; image rollback and infrastructure rollback are different risks.

## 15. Say it in 30 seconds

Publish API/web/worker images once with the git SHA after CI, then deploy that immutable release. The environment switches live in committed Pulumi YAML; deployed image tag lives in SSM and is written by CD. Migration runs before rollout. Roll back app images to a known tag while respecting current schema and current infrastructure.

## 16. Status and production work

Repository implementation and local evidence are described above. Live AWS/CI execution remains owner acceptance. 10x: expired approvals and automated rollback criteria. 100x: canary analysis, immutable manifests and cross-service compatibility.

## Where it appears in the story

- [Infra story: 12. ECR](../infra-story.md#12-ecr)
- [Big picture: 4. Components](../00-big-picture.md#4-components)

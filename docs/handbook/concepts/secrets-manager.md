# Secrets Manager

History: see [CHANGELOG.md](../CHANGELOG.md) or run `pnpm docs:history`

Area: AWS Data · Status: ✅ built in repository; live acceptance is separate

## 1. In one line

Secrets Manager supplies RDS-managed DB credentials, cache URL, shared revalidation and ticket signing material to specifically allowed roles. Task-injected values are snapshots until rollout; signer rotation needs a planned key-ring transition, not an unexplained instant replacement.

## 2. Real-life comparison

A durable work tray keeps the task after the customer leaves; a completed stamp identifies a repeat.

## 3. Picture it

```mermaid
flowchart LR
    n0["Secrets Manager"] --> n1
    n1["Scoped worker role"] --> n2
    n2["Signed ticket bytes"] --> n3
    n3["Verify before use"]
```

## 4. Where in our code

- Anchor: `infra/src/data/secrets.ts` · `createSecrets`: the redis-url secret and its value.

`apps/worker/src/tickets/token.ts` signs/verifies bounded strict claims; `infra/src/tickets/iam.ts` grants only ticket worker secret access; `services/tickets.ts` owner-scopes reads. Run `pnpm demo:tickets` and `pnpm demo:p4-assets` separately. Proposed rotation adds key id plus verification key ring, staged rollout and old-key retirement; this key-ring is not built.

## 5. See it yourself

`apps/worker/src/tickets/token.ts` signs/verifies bounded strict claims; `infra/src/tickets/iam.ts` grants only ticket worker secret access; `services/tickets.ts` owner-scopes reads. Run `pnpm demo:tickets` and `pnpm demo:p4-assets` separately. Proposed rotation adds key id plus verification key ring, staged rollout and old-key retirement; this key-ring is not built.

Failure thought experiment: Are signed QR claims private? No; base64url is readable.

## 6. How it connects

Uses the [current system](../00-big-picture.md); gives a concrete decision to the [scenario](../guides/interview-scenarios.md#secrets-forgery) and [explorer tour](../guides/infra-explorer.html?tour=check-in).

## 7. Our settings and WHY

Secrets Manager supplies RDS-managed DB credentials, cache URL, shared revalidation and ticket signing material to specifically allowed roles. Task-injected values are snapshots until rollout; signer rotation needs a planned key-ring transition, not an unexplained instant replacement. A client must never receive the signing secret or invent a valid ticket.

## 8. Trade-offs

Rotating a single key immediately invalidates old QR tokens unless a key ring is supported. OWASP review also needs abuse, dependency, authorization, logging and incident practices beyond code checks.

## 9. Alternatives and when to choose them

10x: expiry/rotation drills and audit access. 100x: per-environment/key versioning, compromise playbooks and threat modeling.

## 10. What breaks and how we notice

Are signed QR claims private? No; base64url is readable.

## 13. Interview answers at 3 levels

- **Simple:** Secrets Manager supplies RDS-managed DB credentials, cache URL, shared revalidation and ticket signing material to specifically allowed roles. Task-injected values are snapshots until rollout; signer rotation needs a planned key-ring transition, not an unexplained instant replacement.
- **Senior:** Store signing/database credentials in Secrets Manager, expose them only to the runtime that needs them and never log them. HMAC authenticates the original ticket bytes and constant-time comparison rejects tampering; it does not encrypt the payload or prevent reuse. Authorization still checks owner/role and uploads remain untrusted.
- **Lead:** 10x: expiry/rotation drills and audit access. 100x: per-environment/key versioning, compromise playbooks and threat modeling.

## 14. Follow-up questions with answers

Are signed QR claims private? No; base64url is readable.

## 15. Say it in 30 seconds

Store signing/database credentials in Secrets Manager, expose them only to the runtime that needs them and never log them. HMAC authenticates the original ticket bytes and constant-time comparison rejects tampering; it does not encrypt the payload or prevent reuse. Authorization still checks owner/role and uploads remain untrusted.

## 16. Status and production work

Repository implementation and local evidence are described above. Live AWS/CI execution remains owner acceptance. 10x: expiry/rotation drills and audit access. 100x: per-environment/key versioning, compromise playbooks and threat modeling.

## Where it appears in the story

- [Infra story: 6. Secrets Manager](../infra-story.md#6-secrets-manager)
- [Big picture: 4. Components](../00-big-picture.md#4-components)

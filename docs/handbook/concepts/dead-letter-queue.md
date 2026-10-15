# Dead-letter queue (DLQ)

History: see [CHANGELOG.md](../CHANGELOG.md) or run `pnpm docs:history`

Area: Reliability · Status: 📋 stub (built in S1c, card not written yet) · Step doc: none yet

Stub card (series 2, P1 = S1c): the full card (comparison, pictures, trade-offs, interview answers) is written in the D3 handbook catch-up from the P1 entry in [PENDING.md](../PENDING.md).

## 1. In one line

A **dead-letter queue** is where a message goes after too many failed tries (`maxReceiveCount 3`), so one poison message can't come back forever; a person looks at it, fixes the cause, and redrives it.

## 4. Where in our code

- Anchor: `infra/src/jobs/queues.ts` · `createJobQueues`: `minitickets-dev-jobs-dlq` (14-day retention, longer than the main queue's 4 days), the redrive policy and the redrive-allow policy (only our queue may use it).

## Where it appears in the story

Not linked yet: the D3 catch-up adds the story chapter (the booking's side path: queue -> worker).

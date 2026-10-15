# Amazon SQS (message queue)

History: see [CHANGELOG.md](../CHANGELOG.md) or run `pnpm docs:history`

Area: AWS Compute · Status: 📋 stub (built in S1c, card not written yet) · Step doc: none yet

Stub card (series 2, P1 = S1c): the full card (comparison, pictures, trade-offs, interview answers) is written in the D3 handbook catch-up from the P1 entry in [PENDING.md](../PENDING.md).

## 1. In one line

**SQS** (Simple Queue Service) is AWS's message queue: the api drops a "booking confirmed" message into `minitickets-dev-jobs` and moves on; the worker Lambda picks it up later, at least once.

## 4. Where in our code

- Anchor: `infra/src/jobs/queues.ts` · `createJobQueues`: the jobs queue (visibility timeout 60 s = 6 x the Lambda timeout, 4-day retention, long polling, SSE-SQS encryption, redrive to the DLQ after 3 receives).

## Where it appears in the story

Not linked yet: the D3 catch-up adds the story chapter (the booking's side path: queue -> worker).

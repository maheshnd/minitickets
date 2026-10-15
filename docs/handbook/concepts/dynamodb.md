# Amazon DynamoDB (key-value database)

History: see [CHANGELOG.md](../CHANGELOG.md) or run `pnpm docs:history`

Area: AWS Data · Status: 📋 stub (built in S1c, card not written yet) · Step doc: none yet

Stub card (series 2, P1 = S1c): the full card (comparison, pictures, trade-offs, interview answers) is written in the D3 handbook catch-up from the P1 entry in [PENDING.md](../PENDING.md).

## 1. In one line

**DynamoDB** is AWS's serverless key-value database: we keep one item per finished job (`jobKey`) so a duplicate message is recognised, with on-demand billing and TTL clean-up.

## 4. Where in our code

- Anchor: `infra/src/jobs/processed-jobs-table.ts` · `createProcessedJobsTable`: `minitickets-dev-processed-jobs`, PAY_PER_REQUEST, hash key `jobKey`, TTL `expiresAt`.

## Where it appears in the story

Not linked yet: the D3 catch-up adds the story chapter (the booking's side path: queue -> worker).

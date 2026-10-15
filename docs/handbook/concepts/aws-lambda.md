# AWS Lambda (serverless functions)

History: see [CHANGELOG.md](../CHANGELOG.md) or run `pnpm docs:history`

Area: AWS Compute · Status: 📋 stub (built in S1c, card not written yet) · Step doc: none yet

Stub card (series 2, P1 = S1c): the full card (comparison, pictures, trade-offs, interview answers) is written in the D3 handbook catch-up from the P1 entry in [PENDING.md](../PENDING.md).

## 1. In one line

**Lambda** runs our function only when there is work (here: a batch of queue messages) and bills only the milliseconds it runs; nothing runs or costs while idle.

## 4. Where in our code

- Anchor: `infra/src/jobs/worker-lambda.ts` · `createWorkerLambda`: container image, arm64, 256 MB, 10 s timeout, outside the VPC, logs to `/minitickets/dev/worker`.
- Anchor: `infra/src/jobs/queue-trigger.ts` · `createQueueTrigger`: the event source mapping (batch 10, ReportBatchItemFailures, maximumConcurrency 5).
- Anchor: `infra/src/registry.ts` · `allowLambdaPull`: the worker repository lets the Lambda service pull its image.
- Anchor: `apps/worker/src/lambda.ts` · `handler`: the entry point Lambda calls (clients built once per cold start).
- Anchor: `apps/worker/Dockerfile` · stage `runtime`: `public.ecr.aws/lambda/nodejs:24` + one bundled file, `CMD ["lambda.handler"]`.

## Where it appears in the story

Not linked yet: the D3 catch-up adds the story chapter (the booking's side path: queue -> worker).

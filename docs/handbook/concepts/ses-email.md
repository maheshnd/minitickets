# Amazon SES (sending email)

History: see [CHANGELOG.md](../CHANGELOG.md) or run `pnpm docs:history`

Area: AWS Compute · Status: 📋 stub (built in S1c, card not written yet) · Step doc: none yet

Stub card (series 2, P1 = S1c): the full card (comparison, pictures, trade-offs, interview answers) is written in the D3 handbook catch-up from the P1 entry in [PENDING.md](../PENDING.md).

## 1. In one line

**SES** (Simple Email Service) sends our booking confirmation emails from `no-reply@minitickets.theversehub.in`, a domain proven with 3 DKIM DNS records; in the SES sandbox it only sends to verified addresses.

## 4. Where in our code

- Anchor: `infra/src/jobs/email.ts` · `createEmail`: the domain identity with Easy DKIM (records in the `sesDkimRecords` output), the test-recipient identity, the sender address.
- Anchor: `apps/worker/src/ses-mailer.ts` · `SesMailer`: sends one Simple (text) email with the SESv2 `SendEmail` call.

## Where it appears in the story

Not linked yet: the D3 catch-up adds the story chapter (the booking's side path: queue -> worker).

import { SendEmailCommand, type SESv2Client } from "@aws-sdk/client-sesv2";
import type { Email, Mailer } from "./mailer";

// @concept: ses-email
// The REAL mailer, used on AWS (MAILER=ses, set by infra/src/jobs/worker-lambda.ts): sends the
// email through Amazon SES (Simple Email Service). Locally the worker keeps LogMailer (mailer.ts):
// no SES there, and nobody gets real emails from a laptop by accident.
//
// What SES checks before it sends (infra/src/jobs/email.ts sets these up):
//   - FROM must be an address of a VERIFIED identity: our domain, proven with 3 DKIM DNS records.
//   - SANDBOX (every new AWS account starts there): SES also sends only TO verified addresses, at
//     most 200 emails a day and 1 per second. Any other recipient -> "MessageRejected", the message
//     fails, is retried 3 times and lands in the dead-letter queue. Leaving the sandbox is a request
//     to AWS (console: SES -> Account dashboard -> "Request production access").
//   - IAM: the Lambda's role may call ses:SendEmail only on our identities, only from MAIL_FROM
//     (infra/src/jobs/worker-iam.ts).
export class SesMailer implements Mailer {
  private readonly client: Pick<SESv2Client, "send">;
  private readonly from: string;

  constructor(client: Pick<SESv2Client, "send">, from: string) {
    this.client = client;
    this.from = from;
  }

  async send(email: Email): Promise<void> {
    // 1. A "Simple" email: SES builds the MIME message (headers, encoding) for us from a subject and
    //    a text body. UTF-8, so event titles with accents arrive intact.
    //    If SES refuses (sandbox recipient, throttled, identity not verified yet), send() throws and
    //    the message fails: it is retried with backoff, and after 3 tries goes to the DLQ.
    const result = await this.client.send(
      new SendEmailCommand({
        FromEmailAddress: this.from,
        Destination: { ToAddresses: [email.to] },
        Content: {
          Simple: {
            Subject: { Data: email.subject, Charset: "UTF-8" },
            Body: { Text: { Data: email.body, Charset: "UTF-8" } },
          },
        },
      }),
    );

    // 2. Log SES's id for this email (to find it in SES's own records), and only the DOMAIN of the
    //    recipient, never the address (same rule as LogMailer).
    const domain = email.to.split("@")[1] ?? "unknown";
    console.log(`[mailer] SES accepted email ${result.MessageId ?? "?"} to *@${domain}: "${email.subject}"`);
  }
}

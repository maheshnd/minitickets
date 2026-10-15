// LAYER: jobs / email (S1c)
// NEEDS (inputs):   domainName     <- config domainName (minitickets.theversehub.in)
//                   testRecipient  <- config sesTestRecipient (SECRET, optional): your own address
// CREATES:          SES domain identity <domainName> with Easy DKIM (3 DNS records to add by hand),
//                   SES email identity <testRecipient> (AWS emails it a link to click)
// GIVES (outputs):  mailFrom      -> jobs/worker-lambda (MAIL_FROM), jobs/worker-iam (ses:FromAddress)
//                   identityArns  -> jobs/worker-iam (the Lambda may send only with these)
//                   dkimRecords   -> stack output sesDkimRecords (copy them into Cloudflare)
//
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { tagsFor } from "../tags";

// Amazon SES (Simple Email Service): sends the booking confirmation emails.
// Always on (when domainName is set), NOT behind a switch: identities are free, and the DNS records
// you add by hand stay valid only as long as the identity exists. Created once, ready on every
// deploy day (same idea as the certificate, src/certificate.ts).
//
// IDENTITY in simple words: SES only sends FROM an address it knows you own. You prove it for a
// whole DOMAIN with DNS records (here), or for one ADDRESS by clicking a link AWS emails to it.
//
// THE SANDBOX: every new AWS account starts in it (ours too: checked with `aws sesv2 get-account`,
// ProductionAccessEnabled false, 200 emails per 24 h, 1 per second). In the sandbox SES also sends
// only TO verified identities. That is why your own address is verified too (testRecipient): sign up
// in the app with it, book, and the email really arrives. A booking by any other address fails at
// SES ("Email address is not verified"), is retried 3 times and lands in the dead-letter queue: a
// live demo of the DLQ. Leaving the sandbox = a request to AWS (SES console -> Account dashboard ->
// "Request production access"), reviewed by a person; not needed to learn this.

const prefix = "minitickets-dev";

export interface EmailInputs {
  domainName: string;
  testRecipient?: pulumi.Output<string>;
}

export interface EmailOutputs {
  mailFrom: string;
  identityArns: pulumi.Output<string>[];
  dkimRecords: pulumi.Output<{ name: string; type: string; value: string }[]>;
}

// @concept: ses-email
export function createEmail(inputs: EmailInputs): EmailOutputs {
  // 1. The domain identity, with Easy DKIM.
  //    DKIM ("DomainKeys Identified Mail"): SES signs every email with a private key; the matching
  //      public key is published in DNS under our domain. A receiving mail server (Gmail, ...)
  //      checks the signature: "this really comes from minitickets.theversehub.in and was not
  //      changed on the way". Unsigned mail from a new domain usually lands in spam.
  //    "Easy DKIM": AWS makes and rotates the keys. We only add 3 CNAME records (2), once.
  //    RSA_2048_BIT: the stronger key length (1024 is the old default).
  //    SES checks the records by itself every few hours (up to 72 h); the identity turns "Verified"
  //    when they are found. Until then every send fails (and goes to the DLQ after 3 tries).
  // DEPENDS ON: nothing (domainName is a plain value from config).
  const domain = new aws.sesv2.EmailIdentity(`${prefix}-ses-domain`, {
    emailIdentity: inputs.domainName,
    dkimSigningAttributes: { nextSigningKeyLength: "RSA_2048_BIT" },
    tags: tagsFor(`${prefix}-ses-domain`),
  });

  // 2. The 3 DKIM records to add at the DNS provider (Cloudflare, by hand: our DNS is not in AWS).
  //    Each one: <token>._domainkey.<domain>  CNAME  <token>.dkim.amazonses.com
  //    In Cloudflare: proxy OFF ("DNS only", grey cloud). A proxied CNAME would hide the target and
  //    SES would never find the key. They are not secrets: anyone can look them up in DNS.
  //    unsecret: the AWS provider marks the WHOLE dkimSigningAttributes block secret, because it
  //    can also hold a private key (only for "bring your own DKIM", which we don't use). The tokens
  //    are public, and a hidden output would be useless to copy into Cloudflare.
  const dkimRecords = pulumi.unsecret(
    domain.dkimSigningAttributes.apply((attributes) =>
      attributes.tokens.map((token) => ({
        name: `${token}._domainkey.${inputs.domainName}`,
        type: "CNAME",
        value: `${token}.dkim.amazonses.com`,
      })),
    ),
  );

  // 3. The sender address. Any address at the verified domain works; no mailbox has to exist.
  //    "no-reply" says: replies go nowhere (we receive no email at all).
  const mailFrom = `no-reply@${inputs.domainName}`;

  // 4. Your own address as an identity (sandbox only, see the top). AWS emails it a verification
  //    link right after creation; click it once. The address is a Pulumi SECRET (config set
  //    --secret), so it is encrypted in Pulumi.dev.yaml and hidden in previews. (The resource's id
  //    in Pulumi's state, which is not in git, still holds it as plain text.)
  // DEPENDS ON: nothing.
  const recipient = inputs.testRecipient
    ? new aws.sesv2.EmailIdentity(`${prefix}-ses-test-recipient`, {
        emailIdentity: inputs.testRecipient,
        tags: tagsFor(`${prefix}-ses-test-recipient`),
      })
    : undefined;

  return {
    mailFrom,
    identityArns: recipient ? [domain.arn, recipient.arn] : [domain.arn],
    dkimRecords,
  };
}

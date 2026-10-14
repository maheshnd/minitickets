// LAYER: certificate (always on when the domainName config is set; NOT part of the entry switch)
// NEEDS (inputs):   domainName <- from config (e.g. minitickets.theversehub.in)
// CREATES:          ACM certificate for domainName, validated by DNS
// GIVES (outputs):  certificateArn   -> used by the https listener (entry/https-listener.ts)
//                   validationRecord -> stack output: the DNS record YOU add at your DNS provider
//
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { tagsFor } from "./tags";

// The TLS certificate for our own subdomain (Step 11i).
//
// Certificate in simple words:
//   An ID card for a website. The browser asks "are you really minitickets.theversehub.in?" and
//   the server shows a card signed by someone the browser trusts (here: Amazon, through ACM, the
//   AWS Certificate Manager). Without it the browser shows "Not secure" and HTTPS cannot start.
//
// DNS validation in simple words:
//   Before Amazon signs the card, it checks that we CONTROL the domain. It hands us a random
//   record name and value and says "put this in your domain's DNS". Only whoever runs the DNS for
//   theversehub.in can do that, so when Amazon later finds the record, it knows the request is
//   ours. That is all it proves: control of the name, not who we are as a person or company.
//
// Renewal: an ACM certificate is valid for about 13 months. ACM renews it BY ITSELF, for free,
//   as long as the validation record is still in DNS (it checks the same record again).
//   So: add the record once and never delete it.
//
// WHY always on and not behind entryEnabled: validation waits for YOU (adding a record at your
//   DNS provider) and then for DNS to spread, which can take minutes to hours. If the certificate
//   were created only on deploy day, the HTTPS listener would have to wait for it with the
//   meter running. A certificate costs nothing (ACM public certificates are free), so we create it
//   now and it is ISSUED long before we need it.
//
// Region: ACM certificates belong to ONE region, and an ALB can only use a certificate from its
//   own region. Ours is the provider's region, us-east-1, the same as the ALB. (CloudFront only
//   accepts certificates from us-east-1, so this one would also fit CloudFront later.)

const prefix = "minitickets-dev";

export interface CertificateInputs {
  domainName: string;
}

export interface ValidationRecord {
  name: string;
  type: string;
  value: string;
}

export interface CertificateOutputs {
  certificateArn: pulumi.Output<string>;
  validationRecord: pulumi.Output<ValidationRecord>;
}

export function createCertificate(inputs: CertificateInputs): CertificateOutputs {
  // 1. The certificate request
  // WHAT: ask ACM for a certificate for exactly one name, to be proven by a DNS record.
  // WHY one name, no wildcard (*.theversehub.in): least privilege. The certificate is good for
  //     this app only; a leak of it would not cover the owner's other subdomains.
  // DEPENDS ON: nothing. pulumi up returns at once; the certificate stays "Pending validation"
  //     until the record from step 2 is in DNS. Nothing here waits for that (see https-listener.ts).
  const certificate = new aws.acm.Certificate(`${prefix}-cert`, {
    domainName: inputs.domainName,
    validationMethod: "DNS",
    tags: tagsFor(`${prefix}-cert`),
  });

  // 2. The record ACM wants to see
  // WHAT: ACM gives one CNAME record per name on the certificate (we have one name, so [0]):
  //       name  = _<random>.minitickets.theversehub.in.
  //       value = _<random>.<random>.acm-validations.aws.
  // WHY a stack output: our DNS is NOT in Route 53, so Pulumi cannot add the record for us. We
  //     print it so it can be copied into the DNS provider by hand
  //     (pulumi stack output certificateValidationRecord).
  const validationRecord = certificate.domainValidationOptions.apply((options) => ({
    name: options[0].resourceRecordName,
    type: options[0].resourceRecordType,
    value: options[0].resourceRecordValue,
  }));

  return { certificateArn: certificate.arn, validationRecord };
}

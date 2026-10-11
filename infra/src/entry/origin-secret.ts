// LAYER: origin-secret (part of the entry layer)
// NEEDS (inputs):   nothing
// CREATES:          a random value (Pulumi secret) for the X-Origin-Verify header
// GIVES (outputs):  headerName  -> used by cdn (adds the header) and listener (checks it)
//                   headerValue -> same (stays a secret value, never exported)
//
import * as pulumi from "@pulumi/pulumi";
import * as random from "@pulumi/random";

// The shared secret between CloudFront and the ALB.
// See docs/19-infra-cloudfront.md, section "Origin protection".
//
// In simple words:
//   A password that CloudFront says on every request it sends to the ALB. The ALB only lets a
//   request through when it hears the password. Only our CloudFront distribution knows it.

const prefix = "minitickets-dev";

export interface OriginSecretOutputs {
  headerName: string;
  headerValue: pulumi.Output<string>;
}

export function createOriginSecret(): OriginSecretOutputs {
  // 1. The header value
  // WHAT: a random 32-character string, created by Pulumi on our machine.
  // WHY: the security group only checks "is this CloudFront?", and EVERY CloudFront distribution
  //      (also other people's) uses the same IP ranges. The secret proves it is OUR distribution.
  //      special: false keeps it to letters and digits: the ALB treats * and ? in a header
  //      condition as wildcards, so those characters must not appear.
  //      RandomPassword marks the result as a Pulumi SECRET: encrypted in Pulumi state and shown
  //      as [secret] in every preview and log (same as the Valkey token in data/cache.ts).
  // DEPENDS ON: nothing.
  const value = new random.RandomPassword(`${prefix}-origin-verify`, {
    length: 32,
    special: false,
  });

  return { headerName: "X-Origin-Verify", headerValue: value.result };
}

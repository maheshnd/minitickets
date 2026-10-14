// LAYER: https-listener (part of the entry layer, only when cdnEnabled = false; Step 11i)
// NEEDS (inputs):   albArn                               <- from alb
//                   certificateArn                       <- from certificate (always-on layer)
//                   apiTargetGroupArn, webTargetGroupArn <- from target-groups
// CREATES:          a wait for the certificate to be ISSUED,
//                   HTTPS :443 listener (default -> web) + 1 rule (/trpc/* -> api),
//                   HTTP :80 listener (every request -> 301 to https)
// GIVES (outputs):  apiTargetGroupArn -> used by the api service (returned only once its rule exists)
//                   webTargetGroupArn -> used by the web service (returned only once its listener exists)
//
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { tagsFor } from "../tags";

// The listeners for "no CloudFront" mode: the browser talks to the ALB directly, over HTTPS.
// The other mode (cdnEnabled = true, the default) uses listener.ts instead, never both.
//
// TLS termination in simple words:
//   HTTPS is HTTP inside an encrypted tunnel (TLS). Someone has to open the tunnel, show the
//   certificate and decrypt. In CloudFront mode CloudFront does it. In this mode the ALB does it:
//   the browser's tunnel ends at the ALB, and the ALB talks plain HTTP to the tasks inside the VPC,
//   like before (only the alb security group may reach the tasks' ports).
//
// What is different from listener.ts:
//   - port 443 + certificate instead of plain port 80;
//   - NO secret header check: there is no CloudFront to send it. Who may connect is decided by the
//     alb security group alone (alb-public-ingress.ts, the allowedCidrs config);
//   - port 80 only redirects, so an http:// link or a typed address still ends up on https.
//
// Switch modes only while entryEnabled is false. Both modes have a listener on port 80 and AWS
// allows one listener per port; Pulumi creates the new one before it deletes the old one, so a
// switch with entry on fails with "A listener already exists on this port".

const prefix = "minitickets-dev";

export interface HttpsListenerInputs {
  albArn: pulumi.Input<string>;
  certificateArn: pulumi.Input<string>;
  apiTargetGroupArn: pulumi.Input<string>;
  webTargetGroupArn: pulumi.Input<string>;
}

export interface HttpsListenerOutputs {
  apiTargetGroupArn: pulumi.Output<string>;
  webTargetGroupArn: pulumi.Output<string>;
}

export function createHttpsListener(inputs: HttpsListenerInputs): HttpsListenerOutputs {
  // 1. Wait until the certificate is ISSUED
  // WHAT: not a real AWS resource. Pulumi just asks ACM "issued yet?" until the answer is yes.
  // WHY: AWS refuses an HTTPS listener with a certificate that is still pending. Creating the
  //      certificate days before (certificate.ts) means this wait is instant on deploy day.
  // 10 minutes, not the default 75: if the validation record is missing or wrong, waiting longer
  //   does not help. Fail early, fix the record (aws acm describe-certificate), run pulumi up again.
  const validated = new aws.acm.CertificateValidation(
    `${prefix}-cert-issued`,
    { certificateArn: inputs.certificateArn },
    { customTimeouts: { create: "10m" } },
  );

  // 2. HTTPS listener on port 443
  // WHAT: the ALB opens TLS with the browser using our certificate. Default action: forward to
  //       web (every page, /_next/static, /login, /api/revalidate ...).
  // WHY default -> web: without a secret header to check (see the top), "everything that is not
  //     /trpc/*" is simply the web app. This is how the listener looked before Step 11g.
  // sslPolicy = which TLS versions and ciphers the ALB accepts.
  //   ELBSecurityPolicy-TLS13-1-2-2021-06: TLS 1.3 and TLS 1.2 only, with strong ciphers. It is the
  //   policy AWS recommends (and picks in the console). TLS 1.0 and 1.1 are refused: both have known
  //   weaknesses and were officially retired in 2021 (RFC 8996); every current browser speaks 1.2+.
  //   Why not "1.3 only": some older clients and tools still speak only 1.2, and 1.2 with these
  //   ciphers is still considered safe.
  // DEPENDS ON: the ALB, the ISSUED certificate (step 1) and the web target group.
  const https = new aws.lb.Listener(`${prefix}-https`, {
    loadBalancerArn: inputs.albArn,
    port: 443,
    protocol: "HTTPS",
    sslPolicy: "ELBSecurityPolicy-TLS13-1-2-2021-06",
    certificateArn: validated.certificateArn,
    defaultActions: [{ type: "forward", targetGroupArn: inputs.webTargetGroupArn }],
    tags: tagsFor(`${prefix}-https`),
  });

  // 3. Rule: /trpc/* -> api
  // WHAT: the same path split as listener.ts rule 3, without the secret header condition.
  // WHY: the browser calls the api on the same origin as the page (https://<domainName>/trpc/...).
  // DEPENDS ON: the https listener and the api target group.
  const trpcRule = new aws.lb.ListenerRule(`${prefix}-https-trpc-rule`, {
    listenerArn: https.arn,
    priority: 100,
    conditions: [{ pathPattern: { values: ["/trpc/*"] } }],
    actions: [{ type: "forward", targetGroupArn: inputs.apiTargetGroupArn }],
    tags: tagsFor(`${prefix}-https-trpc-rule`),
  });

  // 4. HTTP listener on port 80: redirect only
  // WHAT: answer every plain-http request with "301 Moved Permanently, go to https://" + the same
  //       host, path and query (the ALB keeps those by default). No request ever reaches a task over
  //       plain http.
  // WHY keep port 80 at all: people type addresses without https://, and old links exist. Closing
  //     port 80 would make those time out instead of landing on the right page.
  // WHY 301 (permanent) and not 302: browsers and search engines remember a 301, so the next visit
  //     goes to https directly. HSTS (apps/web/next.config.ts) then makes the browser skip http
  //     entirely, even for the first request of a later visit.
  // DEPENDS ON: the ALB only.
  new aws.lb.Listener(`${prefix}-http-redirect`, {
    loadBalancerArn: inputs.albArn,
    port: 80,
    protocol: "HTTP",
    defaultActions: [
      { type: "redirect", redirect: { protocol: "HTTPS", port: "443", statusCode: "HTTP_301" } },
    ],
    tags: tagsFor(`${prefix}-http-redirect`),
  });

  // 5. Return each target group ARN only once it is connected to the ALB (same reason as
  //    listener.ts step 5): web is connected by the https listener's default action, api by its rule.
  return {
    apiTargetGroupArn: pulumi.all([inputs.apiTargetGroupArn, trpcRule.id]).apply(([arn]) => arn),
    webTargetGroupArn: pulumi.all([inputs.webTargetGroupArn, https.id]).apply(([arn]) => arn),
  };
}

// LAYER: alb-public-ingress (part of the entry layer, only when cdnEnabled = false; Step 11i)
// NEEDS (inputs):   albSgId      <- from security
//                   allowedCidrs <- from config (default ["0.0.0.0/0"])
// CREATES:          2 ingress rules on the alb security group per CIDR: port 80 and port 443
// GIVES (outputs):  nothing (a rule is used by being there)
//
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { tagsFor } from "../tags";
import { prefix } from "../stack";

// Who may open a connection to the ALB when there is no CloudFront in front of it.
//
// In CloudFront mode the alb group lets in only CloudFront's IP ranges (security.ts, rule 6).
// Here the browser connects to the ALB itself, so the group must let in the visitors:
//   - the whole internet ("0.0.0.0/0", the default), or
//   - in dev, maybe only your own IP address ("203.0.113.7/32", see `curl -s https://checkip.amazonaws.com`),
//     so nobody else can use the app while you test. Set it with:
//       pulumi config set --path 'allowedCidrs[0]' 203.0.113.7/32
//
// WHY these rules live in the entry layer and not in security.ts like the CloudFront rule:
//   they only make sense while the ALB exists, and they open the group to (maybe) the whole
//   internet. With entry off nothing wears the alb badge, so we keep the group closed.

export interface AlbPublicIngressInputs {
  albSgId: pulumi.Input<string>;
  allowedCidrs: string[];
}

export function createAlbPublicIngress(inputs: AlbPublicIngressInputs): void {
  // 1. One rule per (CIDR, port). A rule holds one CIDR, so a list of 2 CIDRs = 4 rules.
  //    The index (not the CIDR text) is in the name, because "/" and "." are awkward in names;
  //    changing the order of the list therefore replaces rules, which is harmless.
  inputs.allowedCidrs.forEach((cidr, index) => {
    // 2. Port 443: the real traffic (HTTPS, entry/https-listener.ts step 2).
    new aws.vpc.SecurityGroupIngressRule(`${prefix}-alb-in-443-${index}`, {
      securityGroupId: inputs.albSgId,
      description: `HTTPS from ${cidr}`,
      ipProtocol: "tcp",
      fromPort: 443,
      toPort: 443,
      cidrIpv4: cidr,
      tags: tagsFor(`${prefix}-alb-in-443-${index}`),
    });

    // 3. Port 80: only the redirect to https (entry/https-listener.ts step 4). Without this rule an
    //    http:// address would time out instead of being sent to https.
    new aws.vpc.SecurityGroupIngressRule(`${prefix}-alb-in-80-${index}`, {
      securityGroupId: inputs.albSgId,
      description: `HTTP (redirect to HTTPS) from ${cidr}`,
      ipProtocol: "tcp",
      fromPort: 80,
      toPort: 80,
      cidrIpv4: cidr,
      tags: tagsFor(`${prefix}-alb-in-80-${index}`),
    });
  });
}

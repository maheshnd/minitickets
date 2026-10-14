// The entry layer's two modes (Step 11i), as small pure functions: no AWS resources here, so they
// can be unit-tested (mode.test.ts). index.ts calls them with the Pulumi config values.
//
//   cdnEnabled = true (default):  browser -> CloudFront (https) -> ALB (http :80) -> tasks
//   cdnEnabled = false:           browser -> ALB (https :443, own domain + certificate) -> tasks
import * as pulumi from "@pulumi/pulumi";

// 1. How many proxies the api may trust (TRUST_PROXY_HOPS, apps/api/src/config/trust-proxy.ts).
//    It must be EXACTLY the number of proxies of ours in front of the api:
//    - entry off: no ALB, nothing in front. 0 = trust nobody.
//    - CloudFront mode: CloudFront, then the ALB. 2.
//    - ALB-only mode: just the ALB. 1.
//    WHY not "2 always, to be safe": trusting too MANY hops is the unsafe direction. With only the
//    ALB in front, the X-Forwarded-For the api receives is "<whatever the client sent>, <client IP>"
//    (the ALB appends the address it saw). Trusting 2 hops would skip the real client IP and read
//    the address the CLIENT wrote: anyone could pick their own IP, e.g. to dodge a per-IP rate limit
//    or to fake log lines. Trusting too FEW is merely unhelpful (every request seems to come from
//    the proxy).
export function trustedProxyHops(mode: { entryEnabled: boolean; cdnEnabled: boolean }): 0 | 1 | 2 {
  if (!mode.entryEnabled) return 0;
  return mode.cdnEnabled ? 2 : 1;
}

// 2. domainName: one lowercase DNS name such as minitickets.theversehub.in. Checked here because
//    a typo would become a certificate for the wrong name (and a validation record that never works).
//    undefined (not set) is fine: then there is no certificate and only CloudFront mode is possible.
const DNS_LABEL = "[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?";
const DOMAIN_NAME = new RegExp(`^(${DNS_LABEL}\\.)+[a-z]{2,63}$`);

export function parseDomainName(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (!DOMAIN_NAME.test(value) || value.length > 253) {
    throw new pulumi.RunError(
      `domainName "${value}" is not a valid DNS name. Use lowercase, no "https://", no trailing dot, ` +
        "e.g.: pulumi config set domainName minitickets.theversehub.in",
    );
  }
  return value;
}

// 3. allowedCidrs: who may reach the ALB when cdnEnabled is false (entry/alb-public-ingress.ts).
//    Default: everyone. Each entry must be an IPv4 range like "203.0.113.7/32" (one address) or
//    "0.0.0.0/0" (the whole internet): a security group rule refuses anything else, and we would
//    rather say so in the preview than halfway through pulumi up.
const IPV4_CIDR = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/;

export function parseAllowedCidrs(value: unknown): string[] {
  if (value === undefined) return ["0.0.0.0/0"];
  const isValidCidr = (cidr: unknown): cidr is string => {
    const match = typeof cidr === "string" ? IPV4_CIDR.exec(cidr) : null;
    if (!match) return false;
    const [a, b, c, d, prefixLength] = match.slice(1).map(Number);
    return [a, b, c, d].every((octet) => octet <= 255) && prefixLength <= 32;
  };
  if (!Array.isArray(value) || value.length === 0 || !value.every(isValidCidr)) {
    throw new pulumi.RunError(
      `allowedCidrs must be a non-empty list of IPv4 ranges, got ${JSON.stringify(value)}. ` +
        "e.g.: pulumi config set --path 'allowedCidrs[0]' 203.0.113.7/32",
    );
  }
  return value;
}

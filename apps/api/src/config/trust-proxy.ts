// Fastify's `trustProxy` setting, built from TRUST_PROXY_HOPS. See docs/19-infra-cloudfront.md.
//
// Proxy in simple words:
//   A server that stands between the visitor and us and passes requests on. On AWS there are two:
//   CloudFront, then the ALB. Each one writes down who it got the request from, in the
//   X-Forwarded-For header ("XFF"). The connection the api itself sees comes from the ALB, so
//   without help, request.ip would be the ALB's address for every visitor.
//
// How Fastify reads it: it makes a list of addresses, nearest first:
//   hop 0 = who opened the connection to us   (the ALB)
//   hop 1 = the last address in XFF           (written by the ALB: the CloudFront edge)
//   hop 2 = the one before it                 (written by CloudFront: the real visitor)
//   hop 3+ = anything the visitor sent in its OWN XFF header (can be fake)
// Fastify walks this list while our function says "trusted", and request.ip is the first
// address it does NOT trust. Trusting hops 0 and 1 makes request.ip = hop 2, the visitor.
// Anything a visitor fakes sits at hop 3 or later, so it is never read.
//
// WHY a function and not just the number: Fastify refuses a plain number (it treats it as "trust
//   nothing"), because counting hops is only safe when you KNOW who hop 0 is. On AWS we do: the api
//   security group accepts connections only from the ALB (docs/13-infra-security-groups.md).
//
// The same trusted hop 0 also lets Fastify read X-Forwarded-Proto into request.protocol.

export type TrustProxy = false | ((address: string, hop: number) => boolean);

// @concept: trust-proxy
export function trustProxyHops(hops: number): TrustProxy {
  // 1. 0 hops (local dev, Docker, CI): trust nobody. request.ip is whoever connected to us.
  if (hops === 0) return false;

  // 2. N hops: trust the N nearest addresses, whatever they are.
  return (_address, hop) => hop < hops;
}

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
//
// The second door (Step 11h, infra/src/compute/service-connect.ts): the web SERVER also calls us
// directly, through ECS Service Connect, not through CloudFront and the ALB. Those calls reach us
// from the Service Connect proxy inside our own task, so hop 0 is 127.0.0.1 (localhost). The ALB
// never connects from localhost: it calls the container port directly (the proxy has its own port).
// On such a call there is NO CloudFront and NO ALB in front of us, so any X-Forwarded-For on it was
// written by a caller, not by our proxies, and counting 2 hops would trust it. So: a connection from
// localhost is never trusted, and request.ip is simply 127.0.0.1 ("someone inside our own task").

export type TrustProxy = false | ((address: string, hop: number) => boolean);

// 127.0.0.1 as Node reports it: plain IPv4, or IPv4 written inside IPv6 when the server listens on
// "::" (both stacks). ::1 is IPv6 localhost (Service Connect uses it in IPv6-only setups).
const LOCALHOST = new Set(["127.0.0.1", "::ffff:127.0.0.1", "::1"]);

// @concept: trust-proxy
export function trustProxyHops(hops: number): TrustProxy {
  // 1. 0 hops (local dev, Docker, CI): trust nobody. request.ip is whoever connected to us.
  if (hops === 0) return false;

  // 2. N hops: trust the N nearest addresses, whatever they are, EXCEPT when the connection itself
  //    (hop 0) comes from localhost: that is a Service Connect call, with no proxies of ours in
  //    front (see above). Saying "not trusted" at hop 0 makes Fastify stop right there.
  return (address, hop) => hop < hops && !(hop === 0 && LOCALHOST.has(address));
}

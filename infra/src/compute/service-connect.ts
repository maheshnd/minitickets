// LAYER: service-connect (part of the compute layer, created only when compute AND entry are on)
// NEEDS (inputs):   apiSgId, webSgId <- from security
// CREATES:          Cloud Map HTTP namespace "minitickets.internal",
//                   then 2 ingress rules (api proxy 14000 from web, web proxy 13000 from api)
// GIVES (outputs):  namespaceArn -> used by service (api) and web-service
// CONSTANTS:        apiProxyPort, webProxyPort -> imported by service and web-service
//                   (their ingressPortOverride); fixed numbers, not cloud outputs
//
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { tagsFor } from "../tags";
import { names, prefix } from "../stack";

// ECS Service Connect: a private road between the web and api tasks inside AWS.
//
// WHY we need it (two calls that never leave AWS):
//   - SSR: the web server renders /events by calling the api itself (API_INTERNAL_URL,
//     apps/web/src/lib/trpc/server.ts). Server to server, not through the browser.
//   - Revalidate: after an event is created, the api tells the web server to drop its cached
//     events list (WEB_INTERNAL_URL, apps/api/src/queries/web-cache.ts).
//   Neither can go through the ALB: since Step 11g the ALB lets in only CloudFront (security group)
//   carrying the secret header (listener). And going out to the internet and back in through
//   CloudFront just to reach a neighbour would be slow and silly. So the two services need their
//   own way to find and reach each other privately. In docker compose that was free: compose gives
//   every service a name (http://api:4000). Service Connect gives us the same names on ECS.
//
// Service Connect in simple words:
//   Like an office phone book plus a receptionist in every office.
//   - The phone book is a Cloud Map NAMESPACE (step 1): a list of service names ("api", "web") and
//     which tasks answer for each name right now.
//   - The receptionist is a small PROXY container that ECS adds to every task (a "sidecar": it
//     rides along next to our container). Our code just calls http://api:4000. The proxy in OUR
//     task picks a healthy api task from the phone book and sends the call to the proxy in THAT
//     task, which hands it to the api container on 127.0.0.1:4000.
//
//   web container --http://api:4000--> web's proxy --VPC, port 14000--> api's proxy --127.0.0.1:4000--> api
//
// The ALB does NOT use this road: it keeps calling the containers on 4000 and 3000 directly
// (see the proxy ports below and service.ts 1g).

// The ports the two server-side proxies listen on ("ingressPortOverride" in service.ts and
// web-service.ts). WHY not the default: by default the proxy takes over the container port itself,
// and then ALB traffic would ALSO pass through the proxy. That would change what the api sees: every
// connection would come from 127.0.0.1 and could carry extra X-Forwarded-For entries, breaking the
// hop count in TRUST_PROXY_HOPS (apps/api/src/config/trust-proxy.ts). With an override, the ALB path
// stays exactly as it was in Step 11g, and the proxy has its own door. 1 + the app port, easy to read.
export const apiProxyPort = 14000;
export const webProxyPort = 13000;

export interface ServiceConnectInputs {
  apiSgId: pulumi.Input<string>;
  webSgId: pulumi.Input<string>;
}

export interface ServiceConnectOutputs {
  namespaceArn: pulumi.Output<string>;
}

export function createServiceConnect(inputs: ServiceConnectInputs): ServiceConnectOutputs {
  // 1. The namespace (the phone book)
  // WHAT: a Cloud Map HTTP namespace named "minitickets.internal". Cloud Map is AWS's service
  //       registry: a list of names and the addresses that answer for them.
  // WHY: Service Connect uses it as the registry of service names. Each ECS service with Service
  //      Connect adds itself here ("api", "web"), and ECS keeps the list of task addresses up to date
  //      as tasks start and stop.
  //      HTTP namespace, not a DNS one: the proxies look names up through the Cloud Map API, so no
  //      Route 53 private zone is needed (a DNS namespace would create one, billed monthly).
  //      Our code never sees "minitickets.internal": the client alias (service.ts) makes the short
  //      name "api" work.
  // DEPENDS ON: nothing.
  const namespace = new aws.servicediscovery.HttpNamespace(`${prefix}-namespace`, {
    name: "minitickets.internal",
    description: `Service Connect names for minitickets ${names.stack} (api, web)`,
    tags: tagsFor(`${prefix}-namespace`),
  });

  // 2. Firewall doors for the road. Same idea as security.ts: still SOURCE-GROUP based, no IP ranges.
  //    Task IPs change on every restart, so "allow from the web group" (whatever wears the web badge
  //    right now) is the only rule that stays both tight and correct.
  //    The rules open the PROXY ports, not 4000/3000: the caller's proxy talks to the server's proxy
  //    on its ingressPortOverride. Opening 4000 to web would let web skip the api's proxy and reach
  //    the container directly, which we neither need nor want.
  //    Free, but created only with the entry switch, so an "everything off" stack stays unchanged.

  // 2a. api proxy: port 14000 from the web group only (SSR: web -> api).
  // DEPENDS ON: apiSg (protected) and webSg (allowed source), both from security.
  new aws.vpc.SecurityGroupIngressRule(`${prefix}-api-in-${apiProxyPort}`, {
    securityGroupId: inputs.apiSgId,
    description: "Service Connect proxy from the web tasks",
    ipProtocol: "tcp",
    fromPort: apiProxyPort,
    toPort: apiProxyPort,
    referencedSecurityGroupId: inputs.webSgId,
    tags: tagsFor(`${prefix}-api-in-${apiProxyPort}`),
  });

  // 2b. web proxy: port 13000 from the api group only (revalidate: api -> web).
  // DEPENDS ON: webSg (protected) and apiSg (allowed source).
  new aws.vpc.SecurityGroupIngressRule(`${prefix}-web-in-${webProxyPort}`, {
    securityGroupId: inputs.webSgId,
    description: "Service Connect proxy from the api tasks",
    ipProtocol: "tcp",
    fromPort: webProxyPort,
    toPort: webProxyPort,
    referencedSecurityGroupId: inputs.apiSgId,
    tags: tagsFor(`${prefix}-web-in-${webProxyPort}`),
  });

  // 3. Only the namespace ARN leaves this file. Outbound needs no new rule: web and api already
  //    allow all outbound (security.ts rule 12).
  return { namespaceArn: namespace.arn };
}

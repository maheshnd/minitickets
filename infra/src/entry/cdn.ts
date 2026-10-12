// LAYER: cdn (part of the entry layer)
// NEEDS (inputs):   albDnsName                           <- from alb
//                   originHeaderName, originHeaderValue  <- from origin-secret
// CREATES:          CloudFront distribution (HTTPS on *.cloudfront.net, 3 cache behaviors)
// GIVES (outputs):  appUrl -> used by the api task (WEB_ORIGIN) and as a stack output
//                             (the address you open in the browser)
//
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { tagsFor } from "../tags";

// The CloudFront part of the entry layer.
// See docs/19-infra-cloudfront.md for the diagrams.
//
// CloudFront in simple words:
//   A CDN (content delivery network): hundreds of AWS buildings around the world ("edge
//   locations"). The browser talks to the nearest one over HTTPS. The edge either answers from
//   its own copy (cache HIT) or fetches from our ALB (the "origin") and maybe keeps a copy
//   (cache MISS). For us it does two jobs:
//     1. HTTPS: every distribution gets an https://<id>.cloudfront.net address with a free
//        certificate, so we need no domain name. HTTPS makes the Secure session cookie work.
//     2. Caching: the built JS and CSS files are cached at the edge, close to the visitor.

const prefix = "minitickets-dev";

export interface CdnInputs {
  albDnsName: pulumi.Input<string>;
  originHeaderName: string;
  originHeaderValue: pulumi.Input<string>;
}

export interface CdnOutputs {
  appUrl: pulumi.Output<string>;
}

export function createCdn(inputs: CdnInputs): CdnOutputs {
  // 1. AWS managed policies, looked up by name (reads, not resources we create).
  //    A CACHE policy says how long to keep a copy and what makes two requests "the same"
  //    (the cache key). An ORIGIN REQUEST policy says what to pass on to the ALB.
  //    Managed = written and maintained by AWS, free, and every CloudFront user knows them.
  //    CachingOptimized: cache, key = path only, honour the file's own Cache-Control.
  //    CachingDisabled:  never cache; every request goes to the ALB.
  //    AllViewer:        pass on everything the browser sent: all headers (including Host and
  //                      Cookie), all cookies and the query string.
  const cachingOptimized = aws.cloudfront.getCachePolicyOutput({ name: "Managed-CachingOptimized" });
  const cachingDisabled = aws.cloudfront.getCachePolicyOutput({ name: "Managed-CachingDisabled" });
  const allViewer = aws.cloudfront.getOriginRequestPolicyOutput({ name: "Managed-AllViewer" });

  // 2. The id of our one origin. Every cache behavior points at it by this name.
  const albOriginId = "alb";

  // @concept: cloudfront
  // 3. The distribution
  // WHAT: one CloudFront distribution in front of the ALB.
  // WHY: HTTPS for the browser (the Secure cookie needs it) and caching for static files.
  // DEPENDS ON: the ALB's DNS name (alb.ts) and the secret header (origin-secret.ts).
  // Creating it takes about 5-15 minutes: the settings are copied to every edge location.
  //   `pulumi up` waits until that is done, so appUrl works as soon as up finishes.
  const distribution = new aws.cloudfront.Distribution(`${prefix}-cdn`, {
    enabled: true,
    comment: "minitickets dev: HTTPS in front of the ALB",

    // @concept: http-versions
    // 3a. HTTP/2 and HTTP/3 between the browser and the edge (faster page loads; the browser
    //     picks the best one it supports).
    httpVersion: "http2and3",

    // 3b. PriceClass_100: the cheapest edge locations only (North America and Europe).
    //     Visitors elsewhere still work; they are served from the nearest of those.
    priceClass: "PriceClass_100",

    // 3c. The origin: where CloudFront fetches from when it has no copy.
    origins: [
      {
        originId: albOriginId,
        domainName: inputs.albDnsName,
        customOriginConfig: {
          httpPort: 80,
          httpsPort: 443,
          // @concept: tls-termination
          // http-only: CloudFront talks to the ALB over plain HTTP.
          // Dev compromise: HTTPS needs a certificate for a domain we own, and the ALB's
          //   *.elb.amazonaws.com name belongs to AWS. The hop runs inside the AWS network, but
          //   it is not encrypted. Production puts an ACM certificate + custom domain on the ALB
          //   and uses https-only here, so traffic is encrypted all the way to the ALB.
          originProtocolPolicy: "http-only",
          // Required by the API even with http-only (it applies only to HTTPS origins).
          originSslProtocols: ["TLSv1.2"],
        },
        // @concept: origin-protection
        // The secret header: CloudFront adds it to every request it sends to the ALB.
        // The listener rules let a request through only when it is there (entry/listener.ts).
        customHeaders: [{ name: inputs.originHeaderName, value: inputs.originHeaderValue }],
      },
    ],

    // @concept: cdn-caching
    // 3d. Cache behaviors: CloudFront checks the ordered ones top to bottom by path; the first
    //     match wins. If none match, the default behavior (3e) applies.
    orderedCacheBehaviors: [
      {
        // /_next/static/*: the JS and CSS files Next.js builds.
        // Their file names contain a content hash (e.g. main-3f9a1c.js), so a file with a given
        // name never changes: a new build makes NEW names. That makes them safe to cache for a
        // long time. Next.js already sends "Cache-Control: max-age=31536000, immutable" (1 year).
        pathPattern: "/_next/static/*",
        targetOriginId: albOriginId,
        viewerProtocolPolicy: "redirect-to-https",
        allowedMethods: ["GET", "HEAD"],
        cachedMethods: ["GET", "HEAD"],
        compress: true,
        cachePolicyId: cachingOptimized.id,
      },
      {
        // /trpc/*: the api. Its answers are per-user (they depend on the session cookie: "who am
        // I", "my profile"). A cached copy could show one user's data to the next one. So never
        // cache, and pass on everything (the cookie above all).
        // All HTTP methods: tRPC mutations are POSTs (login, signup, logout).
        pathPattern: "/trpc/*",
        targetOriginId: albOriginId,
        viewerProtocolPolicy: "redirect-to-https",
        allowedMethods: ["GET", "HEAD", "OPTIONS", "PUT", "PATCH", "POST", "DELETE"],
        cachedMethods: ["GET", "HEAD"],
        compress: true,
        cachePolicyId: cachingDisabled.id,
        originRequestPolicyId: allViewer.id,
      },
    ],

    // 3e. Default behavior (*): everything else = the pages.
    //     Pages are dynamic for now (the header shows who is logged in), so never cache them, and
    //     pass the cookie on. GET and HEAD only: pages are only read. Every write goes through
    //     /trpc/*, so a POST to a page is refused at the edge and never reaches the ALB.
    defaultCacheBehavior: {
      targetOriginId: albOriginId,
      // redirect-to-https: a visitor who types http:// gets a 301 to the same https:// address.
      viewerProtocolPolicy: "redirect-to-https",
      allowedMethods: ["GET", "HEAD"],
      cachedMethods: ["GET", "HEAD"],
      // @concept: compression
      // compress: let CloudFront gzip/Brotli responses at the edge. It only takes effect when the
      //   cache policy also enables Gzip and Brotli. CachingOptimized (/_next/static/*) does;
      //   CachingDisabled (this behavior and /trpc/*) does not, so here the setting does nothing and
      //   any compression must come from the origin itself (docs/handbook/concepts/compression.md).
      compress: true,
      cachePolicyId: cachingDisabled.id,
      originRequestPolicyId: allViewer.id,
    },

    // 3f. No country blocking.
    restrictions: { geoRestriction: { restrictionType: "none" } },

    // 3g. The free default certificate for *.cloudfront.net. No domain, no ACM certificate.
    //     (A custom domain like app.example.com would need an ACM certificate in us-east-1.)
    viewerCertificate: { cloudfrontDefaultCertificate: true },

    tags: tagsFor(`${prefix}-cdn`),
  });

  // 4. The address of the app. The distribution's domainName is like d1a2b3c4.cloudfront.net.
  return { appUrl: pulumi.interpolate`https://${distribution.domainName}` };
}

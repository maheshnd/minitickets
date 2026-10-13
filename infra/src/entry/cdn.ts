// LAYER: cdn (part of the entry layer)
// NEEDS (inputs):   albDnsName                           <- from alb
//                   originHeaderName, originHeaderValue  <- from origin-secret
// CREATES:          CloudFront distribution (HTTPS on *.cloudfront.net, 4 cache behaviors)
//                   1 cache policy for the /events page (Step 9b)
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

  // 2b. Our own cache policy for the /events PAGE (Step 9b). No managed policy fits: we need a
  //     cache key with exactly the query strings and headers listed below.
  //
  //     HOW LONG: the web app decides, with its Cache-Control header (apps/web/next.config.ts):
  //       "public, max-age=0, s-maxage=30, stale-while-revalidate=300"
  //       = CloudFront keeps the page 30 s; then, for up to 5 more minutes, it hands out the old
  //         copy once while it fetches a new one in the background. The browser keeps no copy.
  //     The TTLs here are only the edges of what that header may do:
  //     - minTtl 0: CloudFront RESPECTS no-store/private. With minTtl > 0 it would store even
  //       responses marked no-store (AWS docs, "Manage how long content stays in the cache"),
  //       e.g. Next's RSC payloads and error pages below.
  //     - defaultTtl 0: a response WITHOUT Cache-Control is not stored. Example: Next's 307 that
  //       fixes a missing `_rsc`. Nothing gets cached by accident; if the web app ever stops sending
  //       its header, the page is simply not cached (fails closed, never open).
  //     - maxTtl 330: an upper bound on s-maxage, AND the end of the stale-while-revalidate window
  //       (CloudFront serves stale content only until maxTtl). 330 = 30 s fresh + 300 s stale.
  //
  //     WHAT MAKES TWO REQUESTS "THE SAME" (the cache key). Everything in it is also passed on
  //     to the web app; everything else is NOT (there is no origin request policy on /events).
  const eventsPagePolicy = new aws.cloudfront.CachePolicy(`${prefix}-events-page`, {
    name: `${prefix}-events-page`,
    comment: "minitickets /events page: key = venue/from/to + Next.js RSC headers, no cookies",
    minTtl: 0,
    defaultTtl: 0,
    maxTtl: 330,
    parametersInCacheKeyAndForwardedToOrigin: {
      // a. Query strings: ONLY the three filters the page reads (plus `_rsc`, see c).
      //    Everything else is dropped from the key AND from the request to the web app: a link with
      //    ?utm_source=newsletter (or ?x=<random>) gets the SAME cached copy as the plain URL.
      //    Without this list every junk parameter would make a new cache entry and a new render
      //    (key explosion, as in Step 8 for Redis). The filter values themselves are free text,
      //    so ?venue=<random> still makes new entries; each one is a normal, rate-limitable request.
      queryStringsConfig: {
        queryStringBehavior: "whitelist",
        queryStrings: { items: ["venue", "from", "to", "_rsc"] },
      },
      // b. Cookies: none in the key and none passed on. The HTML is the same for every visitor
      //    (checked: logged-in and logged-out HTML differ only in a render timestamp; the header's
      //    "Signed in as" comes from the browser's own auth.me call, after the page loads).
      //    Not passing the cookie on is what KEEPS it that way: the web app cannot render anything
      //    per user here, because it never sees who the user is.
      cookiesConfig: { cookieBehavior: "none" },
      // c. THE RSC TRAP. Next.js uses the SAME URL for two different answers:
      //    - a normal visit (typing the URL, a reload) gets the full HTML page;
      //    - a client-side navigation (clicking a <Link>) sends "RSC: 1" and gets an RSC payload
      //      (React's own format, text/x-component), not HTML.
      //    Next marks this with "Vary: rsc, next-router-state-tree, ...", but CloudFront IGNORES Vary:
      //    it only looks at its cache key. If the key were only the URL, a stored HTML page could be
      //    handed to a navigation (the router gets HTML it cannot read) or a stored RSC payload to a
      //    visitor (the browser shows raw RSC text). So the headers Next varies on go INTO the key:
      //    an HTML request (none of them) and an RSC request never share an entry.
      //    The RSC answers are never stored anyway: Next sends "private, no-store" for them (the
      //    web app's header rule skips requests with an RSC header), and minTtl 0 respects that.
      //    Why `_rsc` and Next-Url too: Next 16 checks that `_rsc` is a hash of these headers and
      //    answers a 307 to the URL with the right `_rsc` when it is missing or wrong. If CloudFront
      //    dropped `_rsc` or one of the headers, the 307 target would lose it again: a redirect loop
      //    on every client-side navigation to /events.
      headersConfig: {
        headerBehavior: "whitelist",
        headers: {
          items: ["RSC", "Next-Router-State-Tree", "Next-Router-Prefetch", "Next-Router-Segment-Prefetch", "Next-Url"],
        },
      },
      // d. Accept-Encoding, normalised by CloudFront to gzip / br / none: a compressed copy is never
      //    sent to a browser that cannot unpack it, and `compress: true` on the behavior works.
      enableAcceptEncodingGzip: true,
      enableAcceptEncodingBrotli: true,
    },
  });

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
      {
        // /events: the public events page, cached at the edge with the policy from 2b (Step 9b).
        // The pattern has no wildcard: it matches the path "/events" only (query strings are not
        // part of the path). /events/ (Next redirects it) and any future /events/<id> page fall
        // through to the default behavior, i.e. are not cached.
        // GET and HEAD only, like every page. NO origin request policy: the web app receives only
        // what is in the cache key (no cookies, no other headers), so its answer can only depend
        // on what the key holds.
        //
        // A NEW EVENT reaches visitors here after at most ~30 s on a busy page (the cached copy's
        // s-maxage); on a quiet page the first visitor within the next 5 min can get the old copy
        // once (stale-while-revalidate). events.create fixes the layers below at once (Redis
        // generation bump, then the Next.js revalidate hook), so this 30 s is then the whole delay.
        // (On AWS the revalidate hook is not wired up yet, so the web app's 30 s data cache adds to it.)
        // Not built, on purpose: a CloudFront INVALIDATION from events.create
        // (CreateInvalidation for "/events*"): the first 1,000 paths a month are free, then
        // $0.005 per path; it takes from seconds to a few minutes to reach every edge; it needs
        // IAM rights + the AWS SDK in the api task; and it can fail like any call. A short TTL costs
        // nothing, needs no code, and its delay (30 s) is known and bounded. Events are created
        // rarely and nobody is harmed by seeing a new one 30 s late.
        pathPattern: "/events",
        targetOriginId: albOriginId,
        viewerProtocolPolicy: "redirect-to-https",
        allowedMethods: ["GET", "HEAD"],
        cachedMethods: ["GET", "HEAD"],
        compress: true,
        cachePolicyId: eventsPagePolicy.id,
      },
    ],

    // 3e. Default behavior (*): everything else = the pages.
    //     Pages are dynamic for now (the header shows who is logged in), so never cache them, and
    //     pass the cookie on. This includes /dashboard and /admin/*, which must never be shared
    //     (the web app also marks them "private, no-store"). Only /events (above) is cached.
    //     GET and HEAD only: pages are only read. Every write goes through
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

# HTTP/1.1 vs HTTP/2 vs HTTP/3

History: see [CHANGELOG.md](../CHANGELOG.md) or run `pnpm docs:history`

Area: API · Status: 🟡 partial (browser to edge only) · Step doc: [19 CloudFront](../../19-infra-cloudfront.md)
<!-- interview-card: v2 -->

## 1. What is it?

HTTP is the request-and-response language of the web. Newer versions can carry several requests over one connection and handle network delay differently.

## 2. Why do we need it?

A MiniTickets page loads several scripts and styles. Waiting behind unrelated downloads wastes time, especially on mobile connections where packets can be delayed or lost.

## 3. How does it work?

```mermaid
flowchart LR
browser["Browser: optional CDN mode"] -->|"HTTP/2 or HTTP/3 when supported"| edge["CloudFront"]
    edge -->|"HTTP/1.1 custom-origin connection"| alb["MiniTickets ALB"]
    alb -->|"HTTP/1.1 target connection"| apps["web and api tasks"]
```

1. The client and public endpoint agree on a supported protocol.
2. That connection carries page and asset requests.
3. Each following hop uses its own independently configured connection.

## 4. How do we use it in MiniTickets?

Optional CloudFront configuration offers HTTP/2 and HTTP/3 to viewers. It is currently disabled; the ALB is the public HTTPS entry. The diagram describes the optional CDN path. No live protocol measurement was made for this rewrite.

## 5. Interview-ready answer

“HTTP/2 lets requests share a TCP connection, but a lost TCP packet can delay all its streams. HTTP/3 uses QUIC and avoids that cross-stream transport blocking. In MiniTickets the optional CloudFront setting affects the browser hop, not every downstream connection. I would measure actual user latency before tuning protocols.”

## 6. Important follow-up questions

- **Does HTTP/3 remove all delay from packet loss?** No. The affected stream still waits; it avoids blocking unrelated streams at the transport layer.
- **What if a network blocks UDP?** The client can fall back to supported TCP-based HTTP.
- **Does HTTP/2 make batching useless?** No. Batching can still save overhead, although fewer connections make its benefit smaller.
- **How do you check the actual protocol?** Inspect the browser Network protocol column for the request and hop being discussed.

## 7. Advanced details

<details>
<summary>Technical reference</summary>

### Current reading notes

The Area/Status line retains the historical partial status. `cdnEnabled=false` means its configured HTTP/2+3 viewer offering is inactive today. The old curl output and browser-to-edge claims below describe optional CloudFront mode, not a fresh live result. Source sets `httpVersion: "http2and3"`; each downstream hop is separate.

### Implementation reference

- Anchor: `infra/src/entry/cdn.ts` · `httpVersion: "http2and3"`: CloudFront offers HTTP/2 and HTTP/3 to browsers.

What happens:

1. The browser connects with TLS; during the handshake it and CloudFront agree on HTTP/2 (ALPN).
2. CloudFront advertises HTTP/3 (an `alt-svc` response header); a browser that supports it may use
   QUIC on the next requests.
3. Behind the edge, CloudFront to the ALB is a separate connection, and this configured ordinary HTTP path uses **HTTP/1.1**.
   **Verified from AWS docs** ([Request and response behavior for custom origins](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/RequestAndResponseBehaviorCustomOrigin.html),
   section "HTTP version"): "CloudFront forwards requests to your custom origin using HTTP/1.1."
   Our ALB is a custom origin, so `http2and3` only affects the browser ↔ edge hop. This statement describes the ordinary HTTP behaviour used here; gRPC and other protocol-specific features need their own configuration review. CloudFront keeps origin connections open for a few
   seconds and reuses them (persistent connections), which hides much of HTTP/1.1's cost.
4. tRPC's `httpBatchLink` already bundles parallel calls into one request, which matters most on
   HTTP/1.1.

### Inspection and historical evidence

```bash
cd infra && APP=$(pulumi stack output appUrl)
curl -sI --http2 "$APP/" | head -1          # HTTP/2 200
curl -sI "$APP/" | grep -i alt-svc          # h3 advertised
```

In Chrome DevTools → Network, right-click the columns and enable **Protocol**: `h2` or `h3`.

### Settings and reasoning

`http2and3`: free, the browser picks the best it supports, and many small `/_next/static/*` files
load in parallel over one connection.

### Trade-offs

- **Pros:** fewer connections, parallel requests, better on lossy mobile networks (HTTP/3).
- **Cons:** only on the browser hop (this ordinary CloudFront → ALB path uses HTTP/1.1); HTTP/3 uses UDP, which some corporate networks block (browsers
  then fall back).

### Alternatives and scaling

- **HTTP/2 only:** if HTTP/3 caused problems for some clients.
- **gRPC (HTTP/2 end to end):** service-to-service APIs (explain-only card `grpc`, Phase 5).

### Failure diagnosis

Nothing app-visible: clients that cannot do 2 or 3 fall back to HTTP/1.1.

### Access boundaries

HTTP/3 needs UDP 443 to the edge; CloudFront handles that. No change to our security groups.

### Cost

Free.

### Further questions

- *Does HTTP/2 reach your servers?* No. CloudFront talks HTTP/1.1 to custom origins like our ALB,
  and the ALB talks HTTP/1.1 to our tasks. In this optional ordinary HTTP flow, those viewer protocols end at the edge.
- *What is head-of-line blocking?* One lost packet delays everything behind it on a TCP connection.
- *Does HTTP/2 make request batching useless?* It reduces the need, but batching still saves request
  overhead and server work.

### Related reading

- [CloudFront](cloudfront.md)
- [cdn-caching](cdn-caching.md)

[Open this piece in the city explorer](../guides/infra-explorer.html?concept=http-versions#chapter=12&piece=cloudfront).

## Where it appears in the story

- [Infra story: 1. CloudFront](../infra-story.md#1-cloudfront)

</details>

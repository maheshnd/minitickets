# HTTP/1.1 vs HTTP/2 vs HTTP/3

History: see [CHANGELOG.md](../CHANGELOG.md) or run `pnpm docs:history`

Area: API · Status: 🟡 partial (browser to edge only) · Step doc: [19 CloudFront](../../19-infra-cloudfront.md)

## 1. In one line

**HTTP/1.1** sends one request at a time per connection; **HTTP/2** sends many at once over one TCP
connection; **HTTP/3** does the same over QUIC (UDP), avoiding TCP's head-of-line blocking. We offer
2 and 3 between the browser and CloudFront.

## 2. Real-life comparison

HTTP/1.1 is a one-lane road: each car waits for the one in front. HTTP/2 is a multi-lane road, but
one crash (a lost packet) still stops every lane. HTTP/3 gives each lane its own road surface.

## 3. Picture it

```mermaid
flowchart LR
    b["Browser"] -->|"HTTP/2 or HTTP/3<br/>(browser picks)"| cf["CloudFront edge"]
    cf -->|"HTTP/1.1 (always,<br/>to custom origins)"| alb["ALB :80"]
    alb -->|"HTTP/1.1"| t["tasks"]
```

## 4. Where in our code

- Anchor: `infra/src/entry/cdn.ts` · `httpVersion: "http2and3"`: CloudFront offers HTTP/2 and HTTP/3 to browsers.

What happens:

1. The browser connects with TLS; during the handshake it and CloudFront agree on HTTP/2 (ALPN).
2. CloudFront advertises HTTP/3 (an `alt-svc` response header); a browser that supports it may use
   QUIC on the next requests.
3. Behind the edge, CloudFront to the ALB is a separate connection, and it is **always HTTP/1.1**.
   **Verified from AWS docs** ([Request and response behavior for custom origins](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/RequestAndResponseBehaviorCustomOrigin.html),
   section "HTTP version"): "CloudFront forwards requests to your custom origin using HTTP/1.1."
   Our ALB is a custom origin, so `http2and3` only affects the browser ↔ edge hop. There is no
   setting to change this for a normal origin. CloudFront keeps origin connections open for a few
   seconds and reuses them (persistent connections), which hides much of HTTP/1.1's cost.
4. tRPC's `httpBatchLink` already bundles parallel calls into one request, which matters most on
   HTTP/1.1.

## 5. See it yourself

```bash
cd infra && APP=$(pulumi stack output appUrl)
curl -sI --http2 "$APP/" | head -1          # HTTP/2 200
curl -sI "$APP/" | grep -i alt-svc          # h3 advertised
```

In Chrome DevTools → Network, right-click the columns and enable **Protocol**: `h2` or `h3`.

## 6. How it connects

- **Uses ←** [CloudFront](cloudfront.md).
- **Gives →** faster page loads with many static files ([cdn-caching](cdn-caching.md)).

## 7. Our settings and WHY

`http2and3`: free, the browser picks the best it supports, and many small `/_next/static/*` files
load in parallel over one connection.

## 8. Trade-offs

- **Pros:** fewer connections, parallel requests, better on lossy mobile networks (HTTP/3).
- **Cons:** only on the browser hop (CloudFront → ALB is always HTTP/1.1); HTTP/3 uses UDP, which some corporate networks block (browsers
  then fall back).

## 9. Alternatives and when to choose them

- **HTTP/2 only:** if HTTP/3 caused problems for some clients.
- **gRPC (HTTP/2 end to end):** service-to-service APIs (explain-only card `grpc`, Phase 5).

## 10. What breaks, and how we'd notice

Nothing app-visible: clients that cannot do 2 or 3 fall back to HTTP/1.1.

## 11. Reach / Allowed / Password

HTTP/3 needs UDP 443 to the edge; CloudFront handles that. No change to our security groups.

## 12. Cost

Free.

## 13. Interview answers at 3 levels

- **Simple:** Newer HTTP versions load pages faster; CloudFront offers them to browsers.
- **Senior:** HTTP/2 multiplexes requests over one TCP connection; HTTP/3 runs over QUIC so one lost
  packet does not stall other streams. We set `http2and3` on CloudFront, so the browser negotiates the
  best. CloudFront → ALB is always HTTP/1.1 (AWS documents this for custom origins), over reused
  keep-alive connections.
- **Lead:** The win is at the edge, where latency is highest. I would measure with real-user metrics
  before tuning origin protocols, because origin hops are short and inside AWS.

## 14. Follow-up questions interviewers ask

- *Does HTTP/2 reach your servers?* No. CloudFront talks HTTP/1.1 to custom origins like our ALB,
  and the ALB talks HTTP/1.1 to our tasks. HTTP/2 and 3 end at the edge.
- *What is head-of-line blocking?* One lost packet delays everything behind it on a TCP connection.
- *Does HTTP/2 make request batching useless?* It reduces the need, but batching still saves request
  overhead and server work.

## 15. Say it in 30 seconds

"CloudFront speaks HTTP/2 and HTTP/3 to browsers; the browser picks. HTTP/2 multiplexes over one TCP
connection and HTTP/3 over QUIC, which avoids TCP head-of-line blocking. Behind the edge, CloudFront
always speaks HTTP/1.1 to our load balancer."

## 16. Status

🟡 partial: browser ↔ edge only.

## Where it appears in the story

- [Infra story: 1. CloudFront](../infra-story.md#1-cloudfront)

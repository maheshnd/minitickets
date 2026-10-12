import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { trustProxyHops } from "./trust-proxy";

// @concept: trust-proxy
// @concept: in-process-api-tests
// A tiny Fastify app that answers with what it thinks the visitor's IP and protocol are.
// inject() sends a fake request without opening a real port.
async function whoAmI(hops: number, headers: Record<string, string>) {
  const app = Fastify({ trustProxy: trustProxyHops(hops) });
  app.get("/", async (request) => ({ ip: request.ip, protocol: request.protocol }));
  // 1. remoteAddress = who opened the connection: on AWS that is always the ALB (a VPC address).
  const res = await app.inject({ method: "GET", url: "/", headers, remoteAddress: "10.0.0.37" });
  await app.close();
  return res.json();
}

// 2. What arrives on AWS: CloudFront wrote the visitor (203.0.113.7), then the ALB appended the
//    CloudFront edge (130.176.0.1) and set the protocol of ITS listener (http in dev).
const viaCloudFront = { "x-forwarded-for": "203.0.113.7, 130.176.0.1", "x-forwarded-proto": "http" };

describe("trustProxyHops", () => {
  it("0 hops (local): request.ip is whoever connected, forwarded headers are ignored", async () => {
    expect(await whoAmI(0, viaCloudFront)).toEqual({ ip: "10.0.0.37", protocol: "http" });
  });

  it("2 hops (AWS): request.ip is the real visitor, protocol comes from X-Forwarded-Proto", async () => {
    expect(await whoAmI(2, viaCloudFront)).toEqual({ ip: "203.0.113.7", protocol: "http" });
    expect(await whoAmI(2, { ...viaCloudFront, "x-forwarded-proto": "https" })).toMatchObject({
      protocol: "https",
    });
  });

  it("2 hops: an address the visitor fakes in its own X-Forwarded-For is never used", async () => {
    // 3. The visitor sent "X-Forwarded-For: 6.6.6.6". CloudFront keeps it and appends the real
    //    address, so the fake one is the furthest left, at hop 3.
    const headers = { ...viaCloudFront, "x-forwarded-for": "6.6.6.6, 203.0.113.7, 130.176.0.1" };
    expect(await whoAmI(2, headers)).toMatchObject({ ip: "203.0.113.7" });
  });
});

import { describe, expect, it } from "vitest";
import { parseAllowedCidrs, parseDomainName, trustedProxyHops } from "./mode";

describe("trustedProxyHops", () => {
  // 1. The number must match the proxies really in front of the api, never more
  //    (apps/api/src/config/trust-proxy.test.ts shows what a wrong number lets a client do).
  it("entry off: 0, nothing stands in front of the api", () => {
    expect(trustedProxyHops({ entryEnabled: false, cdnEnabled: true })).toBe(0);
    expect(trustedProxyHops({ entryEnabled: false, cdnEnabled: false })).toBe(0);
  });

  it("CloudFront mode: 2 (CloudFront, then the ALB)", () => {
    expect(trustedProxyHops({ entryEnabled: true, cdnEnabled: true })).toBe(2);
  });

  it("ALB-only mode: 1 (just the ALB)", () => {
    expect(trustedProxyHops({ entryEnabled: true, cdnEnabled: false })).toBe(1);
  });
});

describe("parseDomainName", () => {
  it("accepts a plain lowercase name, and 'not set'", () => {
    expect(parseDomainName("minitickets.theversehub.in")).toBe("minitickets.theversehub.in");
    expect(parseDomainName(undefined)).toBeUndefined();
  });

  it("refuses a URL, a trailing dot, upper case, or a single label", () => {
    for (const bad of ["https://minitickets.theversehub.in", "minitickets.theversehub.in.", "MiniTickets.example.com", "localhost", ""]) {
      expect(() => parseDomainName(bad), bad).toThrow(/not a valid DNS name/);
    }
  });
});

describe("parseAllowedCidrs", () => {
  it("defaults to the whole internet when not set", () => {
    expect(parseAllowedCidrs(undefined)).toEqual(["0.0.0.0/0"]);
  });

  it("accepts a list of IPv4 ranges", () => {
    expect(parseAllowedCidrs(["203.0.113.7/32", "10.0.0.0/8"])).toEqual(["203.0.113.7/32", "10.0.0.0/8"]);
  });

  it("refuses a plain IP, an out-of-range number, IPv6, an empty list or a non-list", () => {
    for (const bad of [["203.0.113.7"], ["256.0.0.0/8"], ["1.2.3.4/33"], ["::/0"], [], "0.0.0.0/0", [42]]) {
      expect(() => parseAllowedCidrs(bad), JSON.stringify(bad)).toThrow(/allowedCidrs must be/);
    }
  });
});

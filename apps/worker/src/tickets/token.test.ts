import { describe, expect, it } from "vitest";
import { signTicket, verifyTicket } from "./token";

const secret = "ab".repeat(32);
const claims = { version: 1 as const, ticketId: "10000000-0000-4000-8000-000000000001:1",
  bookingId: "10000000-0000-4000-8000-000000000001", userId: "20000000-0000-4000-8000-000000000002",
  eventId: "30000000-0000-4000-8000-000000000003", seat: 1, eventStartsAt: "2027-01-01T18:00:00.000Z" };

describe("HMAC ticket tokens", () => {
  it("round-trips versioned identity deterministically without personal details", () => {
    const token = signTicket(claims, secret);
    expect(signTicket(claims, secret)).toBe(token);
    expect(verifyTicket(token, secret)).toEqual(claims);
    expect(Buffer.from(token.split(".")[0], "base64url").toString()).not.toContain("email");
  });
  it("rejects a forged event id even with a copied genuine signature", () => {
    const [, signature] = signTicket(claims, secret).split(".");
    const payload = Buffer.from(JSON.stringify({ ...claims, eventId: claims.userId })).toString("base64url");
    expect(() => verifyTicket(`${payload}.${signature}`, secret)).toThrow("invalid ticket signature");
  });
  it("rejects the wrong key and a corrupted signature", () => {
    const token = signTicket(claims, secret);
    expect(() => verifyTicket(token, "cd".repeat(32))).toThrow("invalid ticket signature");
    const [payload] = token.split(".");
    expect(() => verifyTicket(`${payload}.${"A".repeat(43)}`, secret)).toThrow("invalid ticket signature");
  });
  it.each(["", "a.b.c", "a.A", "x".repeat(3000)])("rejects malformed input", token => {
    expect(() => verifyTicket(token, secret)).toThrow("invalid ticket token");
  });
  it("rejects an undersized signing key", () => {
    expect(() => signTicket(claims, "short")).toThrow();
  });
});

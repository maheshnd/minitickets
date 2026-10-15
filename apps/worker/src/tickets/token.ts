import { createHmac, timingSafeEqual } from "node:crypto";
import { TicketClaims } from "@minitickets/shared";
import { z } from "zod";

// 1. At least 256 bits, stored as 64 hex characters in Secrets Manager. Never log it.
export const TicketSigningSecret = z.string().regex(/^[0-9a-f]{64}$/);

export function signTicket(claims: TicketClaims, secret: string): string {
  const payload = Buffer.from(JSON.stringify(TicketClaims.parse(claims))).toString("base64url");
  const signature = createHmac("sha256", Buffer.from(TicketSigningSecret.parse(secret), "hex"))
    .update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

// 2. Authenticate the ORIGINAL bytes before parsing. Strict encoding and a fixed-length,
//    constant-time comparison reject tampering; an HMAC proves issuance, not one-time use.
export function verifyTicket(token: string, secret: string): TicketClaims {
  if (token.length > 2048 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(token)) throw new Error("invalid ticket token");
  const [payload, signature] = token.split(".");
  const expected = createHmac("sha256", Buffer.from(TicketSigningSecret.parse(secret), "hex")).update(payload).digest();
  const actual = Buffer.from(signature, "base64url");
  if (actual.toString("base64url") !== signature || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new Error("invalid ticket signature");
  }
  const claims = TicketClaims.parse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
  if (claims.ticketId !== `${claims.bookingId}:${claims.seat}`) throw new Error("invalid ticket identity");
  return claims;
}

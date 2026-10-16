import { expect, it } from "vitest";
import { securityPolicy } from "./security-policy";
it("production uses a script nonce and restrictive sources; eval is development-only", () => {
  const policy = securityPolicy("random", false);
  expect(policy).toContain("script-src 'self' 'nonce-random' 'strict-dynamic'");
  expect(policy).not.toContain("unsafe-eval"); expect(policy).toContain("frame-ancestors 'none'");
  expect(securityPolicy("random", true, "http://localhost:4101")).toContain("unsafe-eval");
});

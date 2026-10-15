import { beforeEach, expect, it, vi } from "vitest";
import { RateLimitedError, UnavailableError } from "../errors";
const takeToken = vi.fn();
vi.mock("../queries/rate-limits", () => ({ takeToken: (...args: unknown[]) => takeToken(...args) }));
const { enforceRateLimit } = await import("./rate-limits");
beforeEach(() => { takeToken.mockReset(); });
it("uses independent login/IP and booking/user policies", async () => {
  takeToken.mockResolvedValue({ allowed: true });
  await enforceRateLimit("login", "ip"); await enforceRateLimit("booking", "user");
  expect(takeToken.mock.calls).toEqual([["login", "ip", 20, 3000], ["booking", "user", 10, 1000]]);
});
it("carries retry timing and fails closed if Redis cannot enforce the limit", async () => {
  takeToken.mockResolvedValue({ allowed: false, retryAfterSeconds: 3 });
  await expect(enforceRateLimit("login", "ip")).rejects.toMatchObject(new RateLimitedError(3));
  takeToken.mockRejectedValue(new Error("Redis unavailable"));
  await expect(enforceRateLimit("booking", "user")).rejects.toBeInstanceOf(UnavailableError);
});

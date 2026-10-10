import { describe, expect, it } from "vitest";
import { getSafeNext } from "./safe-next";

describe("getSafeNext", () => {
  it("keeps a relative path on our own site", () => {
    expect(getSafeNext("/dashboard")).toBe("/dashboard");
  });

  it("goes home when there is no next value", () => {
    expect(getSafeNext(null)).toBe("/");
  });

  // Each of these could send the user to another site after login (open redirect).
  it.each([
    ["a protocol-relative URL", "//evil.com"],
    ["a backslash trick", "/\\evil.com"],
    ["a full URL", "https://evil.com"],
    ["a javascript: URL", "javascript:alert(1)"],
  ])("rejects %s", (_name, next) => {
    expect(getSafeNext(next)).toBe("/");
  });
});

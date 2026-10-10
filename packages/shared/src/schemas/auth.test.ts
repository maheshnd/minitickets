import { describe, expect, it } from "vitest";
import { SignupInput } from "./auth";

const valid = { email: "bob@example.com", password: "correct-horse", confirmPassword: "correct-horse" };

describe("SignupInput", () => {
  it("trims and lowercases the email", () => {
    const result = SignupInput.parse({ ...valid, email: "  Bob@Example.COM " });
    expect(result.email).toBe("bob@example.com");
  });

  it("rejects passwords that do not match, on confirmPassword", () => {
    const result = SignupInput.safeParse({ ...valid, confirmPassword: "something-else" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["confirmPassword"]);
    }
  });
});

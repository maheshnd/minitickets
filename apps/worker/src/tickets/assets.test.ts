import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { describe, expect, it, vi } from "vitest";
import { signingSecret } from "./assets";
import { LocalTicketSettings } from "./local-stack";

describe("signing secret lifecycle", () => {
  it("retries a failed read, then caches a successfully validated secret", async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error("temporary outage")).mockResolvedValue({ SecretString: "ab".repeat(32) });
    const secret = signingSecret({ send } as unknown as SecretsManagerClient, "ticket-key");
    await expect(secret()).rejects.toThrow("temporary outage");
    expect(await secret()).toBe("ab".repeat(32));
    expect(await secret()).toBe("ab".repeat(32));
    expect(send).toHaveBeenCalledTimes(2);
  });
  it("does not cache a malformed value", async () => {
    const send = vi.fn().mockResolvedValueOnce({ SecretString: "short" }).mockResolvedValue({ SecretString: "ab".repeat(32) });
    const secret = signingSecret({ send } as unknown as SecretsManagerClient, "ticket-key");
    await expect(secret()).rejects.toThrow();
    expect(await secret()).toBe("ab".repeat(32));
  });
});

describe("local setup boundary", () => {
  it.each(["SNS_ENDPOINT", "SQS_ENDPOINT", "S3_ENDPOINT", "SECRETS_MANAGER_ENDPOINT", "DYNAMODB_ENDPOINT"])("refuses remote %s before creating clients", key => {
    expect(() => LocalTicketSettings.parse({ [key]: "https://aws.example.com" })).toThrow();
  });
  it("refuses separate SNS and SQS backends because fan-out would silently fail", () => {
    expect(() => LocalTicketSettings.parse({ SQS_ENDPOINT: "http://localhost:9324" })).toThrow();
  });
});

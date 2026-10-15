import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../config/env", () => ({ env: { AWS_REGION: "us-east-1", TICKETS_BUCKET: "unit-assets", S3_ENDPOINT: "http://localhost:5001" } }));
const { signAssetGet } = await import("./assets");
const { signPosterPut } = await import("./posters");
beforeAll(() => { vi.stubEnv("AWS_ACCESS_KEY_ID", "local"); vi.stubEnv("AWS_SECRET_ACCESS_KEY", "local"); vi.stubEnv("AWS_SESSION_TOKEN", ""); });
afterAll(() => vi.unstubAllEnvs());

describe("real SDK presigning", () => {
  it("signs exactly two minutes of ticket access with private cache control and download disposition", async () => {
    const url = new URL(await signAssetGet("tickets/booking/1.png", "ticket-1.png"));
    expect(url.searchParams.get("X-Amz-Expires")).toBe("120");
    expect(url.searchParams.get("response-content-disposition")).toBe('attachment; filename="ticket-1.png"');
    expect(url.searchParams.get("response-cache-control")).toBe("private, no-store");
  });
  it("binds PUT to MIME, exact length and encryption; does not sign an empty-body checksum", async () => {
    const signed = await signPosterPut("poster-uploads/event/admin/uuid", { eventId: "10000000-0000-4000-8000-000000000001", contentType: "image/png", byteLength: 68 });
    const url = new URL(signed.url);
    const headers = url.searchParams.get("X-Amz-SignedHeaders")!.split(";");
    expect(headers).toEqual(expect.arrayContaining(["content-type", "content-length", "x-amz-server-side-encryption"]));
    expect(url.searchParams.get("X-Amz-Expires")).toBe("120");
    expect(url.searchParams.has("x-amz-checksum-crc32")).toBe(false);
  });
  it.each(["poster-uploads/private", "other-bucket/secret", "tickets/../secret"])("refuses an unexpected GET key %s", async key => {
    await expect(signAssetGet(key)).rejects.toThrow("invalid asset prefix");
  });
});

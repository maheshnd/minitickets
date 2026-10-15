import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_POSTER_BYTES } from "@minitickets/shared";

const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("../config/env", () => ({ env: { AWS_REGION: "us-east-1", TICKETS_BUCKET: "assets" } }));
vi.mock("@aws-sdk/client-s3", async importOriginal => ({
  ...await importOriginal<typeof import("@aws-sdk/client-s3")>(),
  S3Client: class { send = send; },
}));
const { inspectPoster, publishPoster } = await import("./posters");
beforeEach(() => send.mockReset());

describe("poster storage boundary", () => {
  it.each([{ ContentLength: MAX_POSTER_BYTES + 1, ContentType: "image/png", ETag: "v1" },
    { ContentLength: 64, ContentType: "image/svg+xml", ETag: "v1" }])("rejects S3 metadata before downloading an invalid object", async metadata => {
    send.mockResolvedValueOnce(metadata);
    expect(await inspectPoster("poster-uploads/test")).toBeNull();
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("pins the bounded read and publication to the validated ETag", async () => {
    send.mockResolvedValueOnce({ ContentLength: 3, ContentType: "image/png", ETag: "original" })
      .mockResolvedValueOnce({ Body: { transformToByteArray: async () => Buffer.from("PNG") } }).mockResolvedValueOnce({});
    const inspected = await inspectPoster("poster-uploads/test");
    expect(inspected?.etag).toBe("original");
    expect(send.mock.calls[1][0].input).toMatchObject({ IfMatch: "original", Range: `bytes=0-${MAX_POSTER_BYTES}` });
    await publishPoster("poster-uploads/test", "posters/published.png", inspected!.etag, inspected!.contentType);
    expect(send.mock.calls[2][0].input).toMatchObject({ CopySourceIfMatch: "original", MetadataDirective: "REPLACE", ServerSideEncryption: "AES256" });
  });
});

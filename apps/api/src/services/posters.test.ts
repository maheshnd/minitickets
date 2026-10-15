import { beforeEach, describe, expect, it, vi } from "vitest";

const { find, save, put, inspect, publish, sign } = vi.hoisted(() => ({ find: vi.fn(), save: vi.fn(), put: vi.fn(), inspect: vi.fn(), publish: vi.fn(), sign: vi.fn() }));
vi.mock("../queries/events", () => ({ findById: find, setPosterKey: save }));
vi.mock("../queries/posters", () => ({ signPosterPut: put, inspectPoster: inspect, publishPoster: publish }));
vi.mock("../queries/assets", () => ({ signAssetGet: sign }));
const { start, complete } = await import("./posters");
const eventId = "10000000-0000-4000-8000-000000000001";
const uploadId = "20000000-0000-4000-8000-000000000002";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAACAAAAAwCAIAAAD/zu84AAAAL0lEQVR4nO3NMQ0AAAgDsKnjRiwCUcFB0qR/Uz2nIhAIBAKBQCAQCAQCgUAg+BQsPUm8agK/tIcAAAAASUVORK5CYII=", "base64");
beforeEach(() => {
  vi.clearAllMocks(); find.mockResolvedValue({ id: eventId }); save.mockResolvedValue({ id: eventId });
  put.mockResolvedValue({ url: "https://s3.example/put" }); sign.mockResolvedValue("https://s3.example/get");
  inspect.mockResolvedValue({ contentType: "image/png", bytes: png, etag: '"original"' });
  publish.mockResolvedValue(undefined);
});

describe("poster upload lifecycle", () => {
  it("generates the upload path under this admin/event; never uses a client filename", async () => {
    const result = await start("admin-id", { eventId, contentType: "image/png", byteLength: png.length });
    expect(put.mock.calls[0][0]).toBe(`poster-uploads/${eventId}/admin-id/${result.uploadId}`);
  });
  it("validates stored data, copies with its ETag, then attaches only the published key", async () => {
    await complete("admin-id", { eventId, uploadId });
    expect(inspect).toHaveBeenCalledWith(`poster-uploads/${eventId}/admin-id/${uploadId}`);
    expect(publish).toHaveBeenCalledWith(expect.any(String), expect.stringMatching(new RegExp(`^posters/${eventId}/`)), '"original"', "image/png");
    expect(publish.mock.invocationCallOrder[0]).toBeLessThan(save.mock.invocationCallOrder[0]);
    expect(save.mock.calls[0][1]).not.toContain("poster-uploads/");
  });
  it.each([null, { contentType: "image/png", bytes: Buffer.from("<svg><script>bad</script></svg>"), etag: "x" },
    { contentType: "image/jpeg", bytes: png, etag: "x" }])("rejects invalid stored objects without publishing or changing the event", async object => {
    inspect.mockResolvedValue(object);
    await expect(complete("admin-id", { eventId, uploadId })).rejects.toMatchObject({ kind: "BAD_REQUEST" });
    expect(publish).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled();
  });
  it("does not attach data if the upload changed between validation and copy", async () => {
    publish.mockRejectedValue(new Error("PreconditionFailed"));
    await expect(complete("admin-id", { eventId, uploadId })).rejects.toMatchObject({ kind: "BAD_REQUEST" });
    expect(save).not.toHaveBeenCalled();
  });
  it("rejects an unknown event before granting an upload URL", async () => {
    find.mockResolvedValue(undefined);
    await expect(start("admin-id", { eventId, contentType: "image/png", byteLength: 10 })).rejects.toMatchObject({ kind: "NOT_FOUND" });
    expect(put).not.toHaveBeenCalled();
  });
});

import { describe, expect, it } from "vitest";
import { isPosterImage } from "./poster-image";
import { MAX_POSTER_BYTES, PosterUploadInput } from "@minitickets/shared";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAACAAAAAwCAIAAAD/zu84AAAAL0lEQVR4nO3NMQ0AAAgDsKnjRiwCUcFB0qR/Uz2nIhAIBAKBQCAQCAQCgUAg+BQsPUm8agK/tIcAAAAASUVORK5CYII=", "base64");
describe("poster validation", () => {
  it("accepts a small PNG and refuses a MIME mismatch, SVG and truncated data", () => {
    expect(isPosterImage(png, "image/png")).toBe(true);
    expect(isPosterImage(png, "image/jpeg")).toBe(false);
    expect(isPosterImage(Buffer.from("<svg/>"), "image/png")).toBe(false);
    expect(isPosterImage(png.subarray(0, 24), "image/png")).toBe(false);
  });
  it("bounds both uploaded bytes and decoded dimensions", () => {
    const wide = Buffer.from(png); wide.writeUInt32BE(100_000, 16);
    expect(isPosterImage(wide, "image/png")).toBe(false);
    expect(isPosterImage(Buffer.alloc(MAX_POSTER_BYTES + 1), "image/png")).toBe(false);
  });
  it("accepts bounded JPEG frame headers and rejects malformed segment lengths", () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 8, 8, 0, 1, 0, 1, 1, 0xff, 0xd9]);
    expect(isPosterImage(jpeg, "image/jpeg")).toBe(true);
    jpeg.writeUInt16BE(65535, 4);
    expect(isPosterImage(jpeg, "image/jpeg")).toBe(false);
  });
  it.each([{ contentType: "image/svg+xml", byteLength: 1 }, { contentType: "image/png", byteLength: 0 },
    { contentType: "image/jpeg", byteLength: MAX_POSTER_BYTES + 1 }])("refuses invalid upload declarations on the shared boundary", input => {
    expect(PosterUploadInput.safeParse({ eventId: "10000000-0000-4000-8000-000000000001", ...input }).success).toBe(false);
  });
});

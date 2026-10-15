import { z } from "zod";

// 1. One small raster image only. SVG/HTML can execute active content; MIME and size must
//    be checked again on S3's stored object because client declarations are not proof.
export const MAX_POSTER_BYTES = 2 * 1024 * 1024;
export const PosterContentType = z.enum(["image/png", "image/jpeg"]);
export const PosterUploadInput = z.object({
  eventId: z.uuid(), contentType: PosterContentType, byteLength: z.number().int().min(1).max(MAX_POSTER_BYTES),
});
export type PosterUploadInput = z.infer<typeof PosterUploadInput>;
export const PosterUploadOutput = z.object({
  uploadId: z.uuid(), url: z.url(), expiresAt: z.iso.datetime(),
  headers: z.object({ "content-type": PosterContentType, "x-amz-server-side-encryption": z.literal("AES256") }),
});
export const CompletePosterInput = z.object({ eventId: z.uuid(), uploadId: z.uuid() });
export type CompletePosterInput = z.infer<typeof CompletePosterInput>;
export const CompletePosterOutput = z.object({ posterUrl: z.url() });

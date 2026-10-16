import { randomUUID } from "node:crypto";
import type { CompletePosterInput, PosterUploadInput } from "@minitickets/shared";
import { BadRequestError, NotFoundError } from "../errors";
import * as events from "../queries/events";
import * as posters from "../queries/posters";
import { signAssetGet } from "../queries/assets";
import { isPosterImage } from "./poster-image";

// 1. All object paths come from server UUIDs and the authenticated admin, never a filename,
//    URL or arbitrary key from the browser. Each event gets an independent upload capability.
// @concept: presigned-urls
function uploadKey(userId: string, eventId: string, uploadId: string) {
  return `poster-uploads/${eventId}/${userId}/${uploadId}`;
}
async function requireEvent(id: string) {
  if (!await events.findById(id)) throw new NotFoundError("Event not found");
}

export async function start(userId: string, input: PosterUploadInput) {
  await requireEvent(input.eventId);
  const uploadId = randomUUID();
  return { uploadId, ...await posters.signPosterPut(uploadKey(userId, input.eventId, uploadId), input) };
}

export async function complete(userId: string, input: CompletePosterInput) {
  await requireEvent(input.eventId);
  const key = uploadKey(userId, input.eventId, input.uploadId);
  let inspected: Awaited<ReturnType<typeof posters.inspectPoster>>;
  try { inspected = await posters.inspectPoster(key); }
  catch { throw new BadRequestError("Upload could not be verified. Upload the poster again."); }
  // 2. Publishing requires the STORED bytes, MIME, dimensions and size to pass. Never attach
  //    an upload merely because the browser says PUT succeeded. Do not reveal S3 errors.
  if (!inspected || !isPosterImage(inspected.bytes, inspected.contentType)) {
    throw new BadRequestError("Use a PNG or JPEG poster up to 2 MiB, 4096 pixels per side and 16 megapixels.");
  }
  const extension = inspected.contentType === "image/png" ? "png" : "jpg";
  const publishedKey = `posters/${input.eventId}/${randomUUID()}.${extension}`;
  try { await posters.publishPoster(key, publishedKey, inspected.etag, inspected.contentType); }
  catch { throw new BadRequestError("Upload changed or could not be published. Upload the poster again."); }
  // 3. Save only a durable key, not an expiring URL. Updating Postgres LAST prevents event
  //    pages from referencing a missing/unverified object. Unattached copies are harmless.
  const saved = await events.setPosterKey(input.eventId, publishedKey);
  if (!saved) throw new NotFoundError("Event not found");
  return { posterUrl: await signAssetGet(publishedKey) };
}

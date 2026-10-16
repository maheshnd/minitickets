import { CopyObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { MAX_POSTER_BYTES, type PosterUploadInput } from "@minitickets/shared";
import { assetBucket, ASSET_URL_SECONDS, s3 } from "./assets";

// 1. Sign an EXACT Content-Length and MIME header, not only client-side limits. Browsers
//    supply Content-Length for a File body; JS must not try to set that forbidden header.
// @concept: presigned-urls
export async function signPosterPut(key: string, input: PosterUploadInput) {
  const headers = { "content-type": input.contentType, "x-amz-server-side-encryption": "AES256" as const };
  const url = await getSignedUrl(s3, new PutObjectCommand({ Bucket: assetBucket(), Key: key,
    ContentType: input.contentType, ContentLength: input.byteLength, ServerSideEncryption: "AES256" }), {
    expiresIn: ASSET_URL_SECONDS, signableHeaders: new Set(["content-type", "content-length"]),
  });
  return { url, headers, expiresAt: new Date(Date.now() + ASSET_URL_SECONDS * 1000).toISOString() };
}

export async function inspectPoster(key: string) {
  // 2. Trust S3 metadata, not the completion request. Bound the body read independently too;
  //    IfMatch ensures validation and the later copy refer to the same uploaded object.
  const head = await s3.send(new HeadObjectCommand({ Bucket: assetBucket(), Key: key }));
  if (!head.ETag || !head.ContentLength || head.ContentLength > MAX_POSTER_BYTES) return null;
  if (head.ContentType !== "image/png" && head.ContentType !== "image/jpeg") return null;
  const object = await s3.send(new GetObjectCommand({ Bucket: assetBucket(), Key: key,
    IfMatch: head.ETag, Range: `bytes=0-${MAX_POSTER_BYTES}` }));
  const bytes = await object.Body?.transformToByteArray();
  if (!bytes || bytes.length !== head.ContentLength) return null;
  return { contentType: head.ContentType, bytes: Buffer.from(bytes), etag: head.ETag };
}

export async function publishPoster(source: string, destination: string, etag: string, contentType: string) {
  // 3. Copy into a separate immutable published key. Reusing the still-valid upload URL can
  //    only replace quarantine data; CopySourceIfMatch prevents a validation/copy race.
  await s3.send(new CopyObjectCommand({ Bucket: assetBucket(), Key: destination,
    CopySource: `${assetBucket()}/${source}`, CopySourceIfMatch: etag, MetadataDirective: "REPLACE",
    ContentType: contentType, CacheControl: "private, no-store", ServerSideEncryption: "AES256" }));
}

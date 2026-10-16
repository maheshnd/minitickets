import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../config/env";

// 1. AWS uses task credentials; Moto uses the same SDK via a loopback endpoint.
//    No SDK may silently call AWS locally when the feature is unconfigured.
// @concept: presigned-urls
export const assetsEnabled = env.TICKETS_BUCKET !== undefined;
export const s3 = new S3Client({ region: env.AWS_REGION, endpoint: env.S3_ENDPOINT,
  forcePathStyle: !!env.S3_ENDPOINT, maxAttempts: 1, requestChecksumCalculation: "WHEN_REQUIRED",
  requestHandler: { connectionTimeout: 1000, requestTimeout: 3000, throwOnRequestTimeout: true } });
export const ASSET_URL_SECONDS = 120;

export function assetBucket(): string {
  if (!env.TICKETS_BUCKET) throw new Error("asset storage is not configured");
  return env.TICKETS_BUCKET;
}

// 2. Bearer links are short-lived and never cached in Redis/Next's shared cache. Ticket
//    downloads use Content-Disposition because the HTML download attribute is cross-origin.
export async function signAssetGet(key: string, downloadName?: string): Promise<string> {
  if (!/^(tickets|posters)\/[a-zA-Z0-9/_.-]+$/.test(key) || key.includes("..")) throw new Error("invalid asset prefix");
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: assetBucket(), Key: key,
    ResponseCacheControl: "private, no-store", ResponseContentDisposition: downloadName
      ? `attachment; filename="${downloadName}"` : "inline",
  }), { expiresIn: ASSET_URL_SECONDS });
}

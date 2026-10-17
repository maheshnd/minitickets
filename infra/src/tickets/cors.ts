import * as aws from "@pulumi/aws";
import type * as pulumi from "@pulumi/pulumi";
import { prefix } from "../stack";

export function createAssetCors(bucket: pulumi.Input<string>, origin: pulumi.Input<string>) {
  // 1. Browser access is limited to OUR web origin, in either ALB-only or CloudFront mode.
  //    CORS is not authorization: private objects still need a signed GET/PUT URL. No idle fee.
  return new aws.s3.BucketCorsConfiguration(`${prefix}-ticket-assets-cors`, {
    bucket, corsRules: [{ allowedOrigins: [origin], allowedMethods: ["GET", "PUT"],
      allowedHeaders: ["content-type", "content-length", "x-amz-server-side-encryption"],
      exposeHeaders: ["ETag"], maxAgeSeconds: 120 }],
  });
}

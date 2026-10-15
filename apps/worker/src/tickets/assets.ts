import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import QRCode from "qrcode";
import { TicketSigningSecret } from "./token";

// 1. Cache only a successful read per warm process. A transient Secrets Manager failure
//    must not poison every later invocation; no secret is copied into Lambda environment vars.
export function signingSecret(client: SecretsManagerClient, secretId: string): () => Promise<string> {
  let value: string | undefined;
  return async () => {
    if (value === undefined) value = TicketSigningSecret.parse((await client.send(new GetSecretValueCommand({ SecretId: secretId }))).SecretString);
    return value;
  };
}

// 2. Only the stored canonical token is rendered. Repeated/concurrent writes use the SAME key
//    and bytes. No ACL or public URL; the bucket denies public access and enforces encryption.
export function ticketPngWriter(client: S3Client, bucket: string): (key: string, token: string) => Promise<void> {
  return async (key, token) => {
    const png = await QRCode.toBuffer(token, { type: "png", errorCorrectionLevel: "M", margin: 4, scale: 6 });
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: png,
      ContentType: "image/png", ServerSideEncryption: "AES256", CacheControl: "private, no-store" }));
  };
}

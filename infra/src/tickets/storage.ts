import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import * as random from "@pulumi/random";
import { tagsFor } from "../tags";
import { names, prefix } from "../stack";

export function createTicketStorage() {
  // 1. Persistent across compute/data off/on: issued tickets and their signing key must agree.
  //    On-demand DynamoDB and S3 have storage/request fees; the secret has a standing charge
  //    (about $0.40/month before API calls). No VPC resources or security-group rules.
  const table = new aws.dynamodb.Table(`${prefix}-tickets`, {
    name: `${prefix}-tickets`, billingMode: "PAY_PER_REQUEST", hashKey: "userId", rangeKey: "ticketId",
    attributes: ["userId", "ticketId", "eventDate", "eventDateKey"].map(name => ({ name, type: "S" })),
    globalSecondaryIndexes: [{ name: "by-event-date", keySchemas: [{ attributeName: "eventDate", keyType: "HASH" }, { attributeName: "eventDateKey", keyType: "RANGE" }], projectionType: "ALL" }],
    serverSideEncryption: { enabled: true }, tags: tagsFor(`${prefix}-tickets`),
  });
  const account = aws.getCallerIdentityOutput().accountId;
  const bucket = new aws.s3.Bucket(`${prefix}-ticket-assets`, {
    bucket: pulumi.interpolate`${prefix}-ticket-assets-${account}`,
    forceDestroy: false, tags: tagsFor(`${prefix}-ticket-assets`),
  });
  // 2. Private means no ACLs, no public policy and no anonymous access. TLS-only requests;
  //    default SSE-S3 (AES256) avoids adding a paid KMS key and decryption grants.
  const ownership = new aws.s3.BucketOwnershipControls(`${prefix}-ticket-assets-owner`, {
    bucket: bucket.id, rule: { objectOwnership: "BucketOwnerEnforced" },
  });
  const publicAccess = new aws.s3.BucketPublicAccessBlock(`${prefix}-ticket-assets-private`, {
    bucket: bucket.id, blockPublicAcls: true, ignorePublicAcls: true, blockPublicPolicy: true, restrictPublicBuckets: true,
  });
  const encryption = new aws.s3.BucketServerSideEncryptionConfiguration(`${prefix}-ticket-assets-sse`, {
    bucket: bucket.id, rules: [{ applyServerSideEncryptionByDefault: { sseAlgorithm: "AES256" } }],
  });
  const policy = new aws.s3.BucketPolicy(`${prefix}-ticket-assets-tls`, {
    bucket: bucket.id,
    policy: pulumi.jsonStringify({ Version: "2012-10-17", Statement: [{ Effect: "Deny", Principal: "*",
      Action: "s3:*", Resource: [bucket.arn, pulumi.interpolate`${bucket.arn}/*`],
      Condition: { Bool: { "aws:SecureTransport": "false" } },
    }] }),
  });
  // 3. Bound abandoned multipart storage without expiring a ticket BEFORE a far-future event.
  //    Business retention/expiry is deferred; there is no fixed-age deletion of issued QR PNGs.
  const lifecycle = new aws.s3.BucketLifecycleConfiguration(`${prefix}-ticket-assets-lifecycle`, {
    bucket: bucket.id, rules: [{ id: "abort-incomplete-ticket-uploads", status: "Enabled", filter: { prefix: "tickets/" },
      abortIncompleteMultipartUpload: { daysAfterInitiation: 1 } },
      // P4B: rejected/abandoned uploads never become event posters; bound their storage cost.
      { id: "expire-staged-posters", status: "Enabled", filter: { prefix: "poster-uploads/" },
        expiration: { days: 1 }, abortIncompleteMultipartUpload: { daysAfterInitiation: 1 } }],
  });
  // 4. RandomBytes is a secret Pulumi output, encrypted in state. Export only the secret ARN;
  //    the runtime fetches its value with GetSecretValue. No automatic rotation in this phase:
  //    dropping a key would invalidate already-issued HMACs (keep previous keys when adding it).
  const key = new random.RandomBytes(`${prefix}-ticket-signing-key`, { length: 32 });
  const secret = new aws.secretsmanager.Secret(`${prefix}-ticket-signing`, {
    name: `${names.secretPath}/ticket-signing`, recoveryWindowInDays: 7, tags: tagsFor(`${prefix}-ticket-signing`),
  });
  const version = new aws.secretsmanager.SecretVersion(`${prefix}-ticket-signing-value`, {
    secretId: secret.id, secretString: pulumi.secret(key.hex),
  });
  return { tableArn: table.arn, tableName: table.name, bucketArn: bucket.arn,
    bucketName: pulumi.all([bucket.bucket, ownership.id, publicAccess.id, encryption.id, policy.id, lifecycle.id]).apply(([name]) => name),
    secretArn: pulumi.all([secret.arn, version.id]).apply(([arn]) => arn) };
}

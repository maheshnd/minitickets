// LAYER: secrets (part of the data layer)
// NEEDS (inputs):   redisEndpoint <- from cache (primaryEndpoint)
//                   authToken     <- from cache
// CREATES:          Secrets Manager secret (redis-url), then its secret version (the URL)
// GIVES (outputs):  redisUrlSecretArn -> used by iam (execution role) and task (REDIS_URL)
//
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { tagsFor } from "../tags";
import { names, prefix } from "../stack";

// The secrets part of the data layer: the full Redis URL, stored in Secrets Manager.
// See docs/14-infra-data.md for the diagrams.
//
// Secrets Manager in simple words:
//   A locked safe inside AWS. You put a value in, and only callers that IAM allows can read
//   it back. Every read is logged. Our containers (Step 11e) will get their passwords from
//   here, so no password is ever written into code, images or plain environment files.
//
// We do NOT create a secret for the Postgres password: RDS already made one for us
// (manageMasterUserPassword in postgres.ts).

export interface SecretsInputs {
  redisEndpoint: pulumi.Input<string>;
  authToken: pulumi.Input<string>;
}

export interface SecretsOutputs {
  redisUrlSecretArn: pulumi.Output<string>;
}

// @concept: secrets-manager
export function createSecrets(inputs: SecretsInputs): SecretsOutputs {
  // 1. The secret (the safe itself, still empty)
  // WHAT: a Secrets Manager entry named "minitickets/dev/redis-url".
  // WHY: the api needs ONE value, REDIS_URL, exactly like apps/api/.env. Storing the whole
  //      URL means the container does not have to build it from pieces.
  // DEPENDS ON: nothing.
  // recoveryWindowInDays 0: delete at once when the data layer is switched off. By default
  //   AWS keeps a deleted secret for 7-30 days and blocks its NAME, so switching the layer
  //   back on would fail with "secret is scheduled for deletion". Production: keep the
  //   default window, so a deleted secret can be recovered.
  const secret = new aws.secretsmanager.Secret(`${prefix}-redis-url`, {
    name: `${names.secretPath}/redis-url`,
    description: "REDIS_URL for the minitickets api (rediss://:<token>@<host>:6379)",
    recoveryWindowInDays: 0,
    tags: tagsFor(`${prefix}-redis-url`),
  });

  // 2. The secret version (what is inside the safe)
  // WHAT: the URL rediss://:<token>@<primary endpoint>:6379.
  //       rediss = Redis over TLS. The empty part before ":" is the username (none, so the
  //       default user); the part after ":" is the auth token.
  // WHY: this is the format ioredis and our env check (apps/api/src/config/env.ts) accept.
  // DEPENDS ON: secret, plus inputs.redisEndpoint and inputs.authToken (from cache).
  //   pulumi.secret(...) keeps the URL encrypted in Pulumi state and hidden in previews,
  //   because it contains the token.
  new aws.secretsmanager.SecretVersion(`${prefix}-redis-url-value`, {
    secretId: secret.id,
    secretString: pulumi.secret(
      pulumi.interpolate`rediss://:${inputs.authToken}@${inputs.redisEndpoint}:6379`,
    ),
  });

  // 3. Only the ARN leaves this file. The ARN is the safe's address, not its contents.
  return { redisUrlSecretArn: secret.arn };
}

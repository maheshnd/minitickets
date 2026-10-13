// LAYER: revalidate-secret (part of the compute layer, created only when compute AND entry are on)
// NEEDS (inputs):   nothing
// CREATES:          a random value (Pulumi secret), a Secrets Manager secret
//                   (minitickets/dev/revalidate-secret), then its secret version (the value)
// GIVES (outputs):  secretArn -> used by iam + web-iam (who may read it) and task + web-task
//                   (REVALIDATE_SECRET in both containers)
//
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as random from "@pulumi/random";
import { tagsFor } from "../tags";

// The shared secret of the revalidate hook, stored in Secrets Manager.
//
// In simple words:
//   A password that the api says when it calls POST /api/revalidate on the web server
//   (apps/api/src/queries/web-cache.ts). The web app only drops its cached events list when it
//   hears the right password (apps/web/src/app/api/revalidate/route.ts). Both sides need the SAME
//   value, so it lives in ONE safe that both task definitions point at.
//
// WHY a password at all, when the security group already lets only the api reach the web proxy:
//   Two locks, like the origin secret (entry/origin-secret.ts). The firewall says "this call comes
//   from something wearing the api badge"; the secret says "it is our api code". And the app code
//   must work the same locally and in docker compose, where there is no such firewall.
//
// WHY Secrets Manager and not a plain env var in the task definition:
//   A plain env var is readable by anyone who can view the task definition (console, API, logs of
//   `pulumi preview`). With a secret, the task definition holds only WHERE the value is; ECS reads it
//   with the execution role when the task starts. Same pattern as REDIS_URL (data/secrets.ts).

const prefix = "minitickets-dev";

export interface RevalidateSecretOutputs {
  secretArn: pulumi.Output<string>;
}

export function createRevalidateSecret(): RevalidateSecretOutputs {
  // 1. The value
  // WHAT: a random 64-character string of letters and digits, made by Pulumi on our machine.
  // WHY: RevalidateSecretSchema (packages/shared) needs at least 32 characters; 64 is far beyond
  //      guessing. special: false avoids characters that need escaping in an HTTP header.
  //      RandomPassword marks the result as a Pulumi SECRET: encrypted in state, [secret] in previews.
  // DEPENDS ON: nothing.
  const value = new random.RandomPassword(`${prefix}-revalidate-value`, {
    length: 64,
    special: false,
  });

  // 2. The secret (the safe, still empty)
  // WHAT: a Secrets Manager entry named "minitickets/dev/revalidate-secret".
  // DEPENDS ON: nothing.
  // recoveryWindowInDays 0: delete at once when the entry switch is turned off, so turning it back
  //   on does not fail with "secret is scheduled for deletion" (same reason as data/secrets.ts).
  const secret = new aws.secretsmanager.Secret(`${prefix}-revalidate-secret`, {
    name: "minitickets/dev/revalidate-secret",
    description: "REVALIDATE_SECRET shared by the minitickets api and web tasks",
    recoveryWindowInDays: 0,
    tags: tagsFor(`${prefix}-revalidate-secret`),
  });

  // 3. The secret version (what is inside the safe)
  // DEPENDS ON: secret and value.
  const version = new aws.secretsmanager.SecretVersion(`${prefix}-revalidate-secret-value`, {
    secretId: secret.id,
    secretString: value.result,
  });

  // 4. Only the ARN leaves this file (the safe's address, not its contents), and only once the
  //    value is inside. WHY wait: a task that starts while the safe is still empty fails with
  //    "ResourceNotFoundException ... AWSCURRENT". pulumi.all waits for both; we keep just the ARN.
  return { secretArn: pulumi.all([secret.arn, version.id]).apply(([arn]) => arn) };
}

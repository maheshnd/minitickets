// Which image tag each piece of the compute layer runs (Step 12b), as a small pure function: no AWS
// resources here, so it can be unit-tested (image-tag.test.ts). index.ts calls it with the value
// read from SSM (release.ts) and the Pulumi config values.
//
//   SSM /minitickets/dev/image-tag  ── written by CD (cd.yml, phase B) after a successful migration
//          │
//          ▼
//   chooseImageTags ──▶ api tag, web tag        (the services)
//                   ──▶ migration tag           (the migration task definition)
//
// Priority, highest first:
//   api / web:  config apiImageTag / webImageTag (EMERGENCY / MANUAL USE ONLY) > SSM
//   migration:  config migrationImageTag (set ONLY by CD with --config, never committed) > api tag
import * as pulumi from "@pulumi/pulumi";

// 1. The value the SSM parameter starts with, before the first deploy (release.ts). SSM refuses an
//    empty value, so we need SOME text; it means "nothing deployed yet" and is never used as a tag.
export const NO_TAG_YET = "none";

// 2. What a tag must look like: a git SHA (7 to 40 lowercase hex characters), the same format CD
//    and scripts/push-images.sh push. WHY check it: a typo (or "latest") would only show up as a
//    task that cannot pull its image, minutes later; here it fails in the preview, with a clear message.
const IMAGE_TAG = /^[0-9a-f]{7,40}$/;

export interface ImageTagInputs {
  // The value of the SSM parameter: undefined if it does not exist yet, NO_TAG_YET before the first deploy.
  deployedTag: string | undefined;
  // Pulumi config overrides; undefined = not set (the normal case).
  apiImageTag: string | undefined;
  webImageTag: string | undefined;
  migrationImageTag: string | undefined;
}

export interface ImageTags {
  api: string;
  web: string;
  migration: string;
}

export function chooseImageTags(inputs: ImageTagInputs): ImageTags {
  // 3. The deployed tag from SSM, unless it is missing or still the placeholder.
  const deployed =
    inputs.deployedTag === undefined || inputs.deployedTag === NO_TAG_YET ? undefined : inputs.deployedTag;

  // 4. Each service: its config override if set, else the deployed tag.
  const api = inputs.apiImageTag ?? deployed;
  const web = inputs.webImageTag ?? deployed;

  // 5. No tag anywhere and compute is on (index.ts only calls this then): stop with a clear message.
  //    WHY no default: a "latest" default would hide WHICH code runs (immutable-image-tags).
  if (api === undefined || web === undefined) {
    throw new pulumi.RunError(
      "computeEnabled is true, but no image tag has been deployed yet (SSM /minitickets/dev/image-tag " +
        "is missing or still 'none'). Deploy through CD: commit + push, then approve the deploy job " +
        "(docs/handbook/PENDING.md, Step 12b). Emergency only: pulumi config set apiImageTag <sha> " +
        "and webImageTag <sha>.",
    );
  }

  // 6. The migration runs the NEW image during CD phase A; otherwise the same code as the api.
  const migration = inputs.migrationImageTag ?? api;

  // 7. Every tag must look like a git SHA (2).
  for (const [name, tag] of Object.entries({ api, web, migration })) {
    if (!IMAGE_TAG.test(tag)) {
      throw new pulumi.RunError(
        `The ${name} image tag "${tag}" is not a git SHA (7-40 lowercase hex characters). ` +
          "Check SSM /minitickets/dev/image-tag and the config keys apiImageTag, webImageTag, migrationImageTag.",
      );
    }
  }

  return { api, web, migration };
}

// LAYER: release
// NEEDS (inputs):   nothing
// CREATES:          1 SSM parameter /minitickets/dev/image-tag (the tag that is DEPLOYED right now)
// GIVES (outputs):  parameterName, parameterArn -> cicd (the deploy role may write ONLY this one)
//                   readDeployedImageTag()      -> index.ts (which tag the services run)
//
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { tagsFor } from "./tags";
import { NO_TAG_YET } from "./image-tag";

// The release layer (Step 12b): ONE record that says which image tag is deployed.
// Always on: a standard SSM parameter is free.
//
// WHO writes what (two owners, each for their own part):
//   Pulumi  creates the parameter ONCE (with the placeholder "none") and never touches its value again.
//   CD      writes the value (cd.yml, phase B) after the migration has succeeded.
//   Pulumi  READS the value on every preview / up, so the services run that tag (index.ts 9b).
//
//   cd.yml phase B ── aws ssm put-parameter ──▶ /minitickets/dev/image-tag = 9f8e7d6
//   pulumi up ── reads it ──▶ api + web task definitions use :9f8e7d6
//
// WHY SSM and not Pulumi config: the deployed tag changes on every deploy, from GitHub Actions.
//   In config it would mean a commit per deploy (CD pushing to main), or a value that exists only
//   on one machine. In SSM it is ONE value in AWS that a local `pulumi up` and CD both read, so
//   neither can roll the app back by accident (single source of truth).

const prefix = "minitickets-dev";

// 1. The parameter's name. A path: "/minitickets/dev/" groups everything of this environment, so
//    readDeployedImageTag (3) can list the path and IAM can name exactly this one (cicd.ts).
export const imageTagParameterName = "/minitickets/dev/image-tag";
const parameterPath = "/minitickets/dev";

export interface ReleaseOutputs {
  parameterName: pulumi.Output<string>;
  parameterArn: pulumi.Output<string>;
}

export function createRelease(): ReleaseOutputs {
  // 2. The parameter.
  //    type String: a plain value, not a secret (a git SHA is public in the repo anyway).
  //      insecureValue (not value): stores it in Pulumi's state as plain text, so previews show it.
  //    tier Standard: free (up to 10,000 parameters per account and region).
  //    ignoreChanges insecureValue: CD changes the value outside Pulumi. Without this line, the next
  //      `pulumi up` would see "AWS says 9f8e7d6, my code says none" and write "none" back, which
  //      would break the next deploy (no tag). With it, Pulumi only creates the parameter.
  // DEPENDS ON: nothing.
  const parameter = new aws.ssm.Parameter(
    `${prefix}-image-tag`,
    {
      name: imageTagParameterName,
      description: "Image tag deployed to dev (api + web). Written by CD after a successful migration.",
      type: "String",
      tier: "Standard",
      insecureValue: NO_TAG_YET,
      tags: tagsFor(`${prefix}-image-tag`),
    },
    { ignoreChanges: ["insecureValue"] },
  );

  return { parameterName: parameter.name, parameterArn: parameter.arn };
}

// 3. Read the CURRENT value from AWS (not from Pulumi's state, which still says "none": see 2).
//    WHY getParametersByPath (list everything under /minitickets/dev) and not getParameter: the
//      very first `pulumi up` reads BEFORE the parameter exists. getParameter would fail there,
//      a path listing just comes back empty.
//    unsecret: the AWS provider marks every listed value as secret (it cannot know which ones are).
//      A tag is not secret, and a secret image name would hide WHICH tag a preview deploys.
//    Gives undefined when the parameter does not exist yet.
export function readDeployedImageTag(): pulumi.Output<string | undefined> {
  const listing = aws.ssm.getParametersByPathOutput({ path: parameterPath, withDecryption: false });
  return pulumi.unsecret(listing).apply((result) => {
    const index = result.names.indexOf(imageTagParameterName);
    return index === -1 ? undefined : result.values[index];
  });
}
